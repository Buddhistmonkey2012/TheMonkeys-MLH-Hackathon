import { createHash, createPublicKey, randomBytes, randomUUID, scrypt, timingSafeEqual, verify } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const sessionLifetime = 14 * 86400;
const stateLifetime = 600;
const sessionName = 'tw_session';
const googleCookie = 'tw_google_state';
const googlePath = '/auth/google';
const routes = new Set(['/auth/status','/auth/register','/auth/sign-in','/auth/sign-out',googlePath,googlePath + '/callback']);
const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const googleKeysUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const passwordOptions = {N:32768,r:8,p:3,maxmem:64 * 1024 * 1024};
const validPassword = value => typeof value === 'string' && Buffer.byteLength(value) <= 512;

function equal(a, b) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function normalizedEmail(input) {
  if (typeof input !== 'string') return '';
  const email = input.trim().toLowerCase();
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
}
function nameFrom(input) {
  return typeof input === 'string' ? input.trim().slice(0,60) : '';
}
function cookieValue(request, name) {
  const found = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  const value = found?.slice(name.length + 1);
  return tokenFormat.test(value || '') ? value : null;
}
function json(data, status = 200, cookie) {
  const headers = new Headers({'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'});
  if (cookie) headers.append('Set-Cookie',cookie);
  return new Response(JSON.stringify(data),{status,headers});
}
function redirect(location, cookies = []) {
  const headers = new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer',Location:location});
  for (const cookie of cookies) headers.append('Set-Cookie',cookie);
  return new Response(null,{status:303,headers});
}

export function createAuth({DB, origin, googleClientId, googleClientSecret, googleFetch = fetch}) {
  const googleAvailable = Boolean(googleClientId && googleClientSecret);
  const redirectUri = origin + googlePath + '/callback';
  const secure = origin.startsWith('https:') ? '; Secure' : '';
  const one = (sql,...values) => DB.prepare(sql).bind(...values).first();
  const run = (sql,...values) => DB.prepare(sql).bind(...values).run();
  const batch = items => DB.batch(items.map(([sql,...values]) => DB.prepare(sql).bind(...values)));
  const cookie = (name, value, seconds, path = '/') => name + '=' + value + '; Path=' + path + '; HttpOnly; SameSite=Lax; Max-Age=' + seconds + secure;
  const googleReturn = (status, ...cookies) => redirect('/?auth=' + status,[cookie(googleCookie,'',0,googlePath),...cookies]);
  let keys = {expires:0, list:[]};

  async function getAccount(request) {
    const token = cookieValue(request,sessionName);
    if (!token) return null;
    return one(`SELECT a.id,a.name,a.email,a.google_sub FROM auth_sessions s JOIN accounts a ON a.id=s.account_id
      WHERE s.token_hash=? AND s.expires_at>?`,hash(token),Date.now());
  }

  async function issueSession(accountId, oldToken, accountRow) {
    const token = random();
    const now = Date.now();
    const statements = [
      ['DELETE FROM auth_sessions WHERE expires_at<=?',now],
      ['INSERT INTO auth_sessions(token_hash,account_id,expires_at) VALUES (?,?,?)',hash(token),accountId,now + sessionLifetime * 1000],
    ];
    if (accountRow) statements.unshift(accountRow);
    if (oldToken) statements.push(['DELETE FROM auth_sessions WHERE token_hash=?',hash(oldToken)]);
    await batch(statements);
    return cookie(sessionName,token,sessionLifetime);
  }

  async function allowed(key, limit) {
    const slot = Math.floor(Date.now() / 600000);
    const row = await one(`INSERT INTO auth_limits(key,slot,attempts) VALUES (?,?,1)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.slot=excluded.slot THEN auth_limits.attempts+1 ELSE 1 END,slot=excluded.slot
      RETURNING attempts`,key,slot);
    return row.attempts <= limit;
  }

  async function passwordAction(request, path, ip) {
    const register = path === '/auth/register';
    if (!await allowed('password-ip:' + hash(ip),40)) return json({error:'Too many attempts. Try again in a few minutes.'},429);
    let body;
    try { body = await request.json(); } catch { return json({error:'The form could not be read.'},400); }
    const email = normalizedEmail(body?.email);
    const password = body?.password;
    const name = nameFrom(body?.name);
    if (!email || !validPassword(password)) return json({error:'Enter a valid email address and password.'},400);
    if (register && (!name || [...password].length < 12)) return json({error:'Enter your name and choose a password with at least 12 characters.'},400);
    if (!await allowed('password-email:' + hash(email),8)) return json({error:'Too many attempts. Try again in a few minutes.'},429);
    await run('DELETE FROM auth_limits WHERE slot<?',Math.floor(Date.now()/600000)-2);
    const available = await one('SELECT id,password_salt,password_hash FROM accounts WHERE email=?',email);
    const salt = register ? random() : available?.password_salt || 'tw-dummy-salt';
    const calculated = (await derive(password,salt,32,passwordOptions)).toString('base64url');
    const oldToken = cookieValue(request,sessionName);
    if (!register) {
      if (!available?.password_hash || !equal(calculated,available.password_hash)) return json({error:'The email or password was incorrect.'},401);
      return json({signedIn:true},200,await issueSession(available.id,oldToken));
    }
    const duplicate = () => json({error:'An account already uses that email. Sign in with the method you used when you signed up.'},409);
    if (available) return duplicate();
    const id = randomUUID();
    const accountRow = ['INSERT INTO accounts(id,email,name,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?)',id,email,name,salt,calculated,Date.now()];
    try {
      return json({signedIn:true},201,await issueSession(id,oldToken,accountRow));
    } catch (error) {
      if (await one('SELECT id FROM accounts WHERE email=?',email)) return duplicate();
      throw error;
    }
  }

  async function getGoogleKey(kid) {
    let result = keys.list.find(key => key.kid === kid);
    if (!result || keys.expires <= Date.now()) {
      const response = await googleFetch(googleKeysUrl,{signal:AbortSignal.timeout(8000),redirect:'error'});
      if (!response.ok) throw new Error('Google keys unavailable.');
      const {keys: list} = await response.json();
      const age = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]) || 300;
      keys = {list,expires:Date.now() + Math.min(age,3600) * 1000};
      result = list.find(key => key.kid === kid);
    }
    if (!result || result.kty !== 'RSA' || result.alg && result.alg !== 'RS256') throw new Error('Google signing key unavailable.');
    return createPublicKey({key:result,format:'jwk'});
  }

  async function verifiedGoogleProfile(idToken, nonce) {
    if (typeof idToken !== 'string' || idToken.length > 12000) throw new Error('Google did not provide an identity.');
    const parts = idToken.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid identity token.');
    const [head, body, signature] = parts;
    const {alg,kid} = JSON.parse(Buffer.from(head,'base64url').toString('utf8'));
    if (alg !== 'RS256' || typeof kid !== 'string' || kid.length > 150) throw new Error('Invalid token algorithm.');
    const key = await getGoogleKey(kid);
    if (!verify('RSA-SHA256',Buffer.from(head + '.' + body),key,Buffer.from(signature,'base64url'))) throw new Error('Invalid identity signature.');
    const c = JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    const time = Math.floor(Date.now()/1000);
    const email = normalizedEmail(c.email);
    if (!['https://accounts.google.com','accounts.google.com'].includes(c.iss) || c.aud !== googleClientId
      || (c.azp && c.azp !== googleClientId) || !Number.isInteger(c.exp) || c.exp <= time
      || !Number.isInteger(c.iat) || c.iat > time + 60 || c.iat < time - stateLifetime - 60 || c.nonce !== nonce
      || typeof c.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(c.sub)
      || !email || ![true,'true'].includes(c.email_verified)) throw new Error('Invalid identity claims.');
    return {subject:c.sub,email,name:nameFrom(c.name) || nameFrom(email.split('@')[0])};
  }

  async function startGoogle(request, url, ip) {
    if (!googleAvailable) return googleReturn('google_setup');
    if (!await allowed('google-ip:' + hash(ip),75)) return googleReturn('try_later');
    const link = url.searchParams.get('link') === '1';
    const account = link ? await getAccount(request) : null;
    if (link && !account) return googleReturn('sign_in_first');
    if (link && account.google_sub) return googleReturn('google_connected');
    const state = random(), verifier = random(), nonce = random();
    await batch([
      ['DELETE FROM google_states WHERE expires_at<=?',Date.now()],
      ['INSERT INTO google_states VALUES (?,?,?,?,?,?)',hash(state),verifier,nonce,account?.id || null,
        account ? hash(cookieValue(request,sessionName)) : null,Date.now() + stateLifetime * 1000],
    ]);
    const query = new URLSearchParams({
      client_id:googleClientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',
      state,nonce,code_challenge:hash(verifier),code_challenge_method:'S256',prompt:'select_account',
    });
    return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + query,[cookie(googleCookie,state,stateLifetime,googlePath)]);
  }

  async function finishGoogle(request, url) {
    if (!googleAvailable) return googleReturn('google_setup');
    const cookieState = cookieValue(request,googleCookie);
    const state = url.searchParams.get('state') || '';
    if (!cookieState || !tokenFormat.test(state) || !equal(state,cookieState)) return googleReturn('google_retry');
    const pending = await one('DELETE FROM google_states WHERE token_hash=? AND expires_at>? RETURNING verifier,nonce,account_id,session_hash',hash(state),Date.now());
    if (!pending) return googleReturn('google_retry');
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || !code || code.length > 4000) return googleReturn('google_cancelled');
    const currentToken = cookieValue(request,sessionName);
    if (pending.account_id) {
      const current = await getAccount(request);
      if (current?.id !== pending.account_id || hash(currentToken) !== pending.session_hash) return googleReturn('sign_in_first');
    }
    let profile;
    try {
      const response = await googleFetch(googleTokenUrl,{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        body:new URLSearchParams({code,client_id:googleClientId,client_secret:googleClientSecret,redirect_uri:redirectUri,
          code_verifier:pending.verifier,grant_type:'authorization_code'}),
      });
      if (!response.ok) return googleReturn('google_retry');
      const tokens = await response.json();
      profile = await verifiedGoogleProfile(tokens.id_token,pending.nonce);
    } catch {
      return googleReturn('google_retry');
    }
    const prior = await one('SELECT id FROM accounts WHERE google_sub=?',profile.subject);
    if (pending.account_id) {
      if (prior) return googleReturn(prior.id === pending.account_id ? 'google_connected' : 'google_in_use');
      try {
        const row = await one(`UPDATE accounts SET google_sub=? WHERE id=? AND email=? AND google_sub IS NULL
          AND EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=? AND account_id=? AND expires_at>?) RETURNING id`,
        profile.subject,pending.account_id,profile.email,pending.session_hash,pending.account_id,Date.now());
        return googleReturn(row ? 'google_connected' : 'google_email_mismatch');
      } catch (error) {
        if (await one('SELECT id FROM accounts WHERE google_sub=?',profile.subject)) return googleReturn('google_in_use');
        throw error;
      }
    }
    if (prior) return googleReturn('signed_in',await issueSession(prior.id,currentToken));
    if (await one('SELECT id FROM accounts WHERE email=?',profile.email)) return googleReturn('link_existing');
    const id = randomUUID();
    try {
      const account = ['INSERT INTO accounts(id,email,name,google_sub,created_at) VALUES (?,?,?,?,?)',id,profile.email,profile.name,profile.subject,Date.now()];
      return googleReturn('signed_in',await issueSession(id,currentToken,account));
    } catch (error) {
      const linked = await one('SELECT id FROM accounts WHERE google_sub=?',profile.subject);
      if (linked) return googleReturn('signed_in',await issueSession(linked.id,currentToken));
      if (await one('SELECT id FROM accounts WHERE email=?',profile.email)) return googleReturn('link_existing');
      throw error;
    }
  }

  async function handle(request, ip) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!routes.has(path)) return null;
    if (request.method === 'GET') {
      if (path === '/auth/status') {
        const account = await getAccount(request);
        return json({accounts:true,signedIn:!!account,googleAvailable});
      }
      if (path === googlePath) return startGoogle(request,url,ip);
      if (path === googlePath + '/callback') return finishGoogle(request,url);
    }
    if (request.method !== 'POST' || !['/auth/register','/auth/sign-in','/auth/sign-out'].includes(path)) return json({error:'This action requires a form.'},405);
    if (request.headers.get('origin') !== origin || !request.headers.get('content-type')?.startsWith('application/json')) return json({error:'Open the workspace to make this change.'},403);
    if (path === '/auth/sign-out') {
      const token = cookieValue(request,sessionName);
      if (token) await run('DELETE FROM auth_sessions WHERE token_hash=?',hash(token));
      return json({signedIn:false},200,cookie(sessionName,'',0));
    }
    return passwordAction(request,path,ip);
  }
  return {getAccount,handle,googleAvailable};
}

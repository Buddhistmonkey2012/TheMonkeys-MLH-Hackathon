import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { openDatabase } from './local-db.mjs';
import { createLocalApplication } from './local-app.mjs';

const directory = new URL('./.data/', import.meta.url);
await mkdir(directory, {recursive:true});
const accounts = process.argv.includes('--accounts');
const databaseName = accounts ? 'workspace.sqlite' : 'demo.sqlite';
const {DB} = await openDatabase(process.env.DEMO_DB === ':memory:' ? ':memory:' : new URL(databaseName,directory));
const port = Number(process.env.TECHWOMEN_PORT || 4173);
const bind = accounts ? process.env.APP_BIND_ADDRESS || '127.0.0.1' : '127.0.0.1';
let origin;
let handleRequest;
if (accounts && process.env.APP_ORIGIN) {
  const configured = new URL(process.env.APP_ORIGIN);
  const local = ['localhost','127.0.0.1','[::1]'].includes(configured.hostname);
  if (configured.origin !== process.env.APP_ORIGIN || (configured.protocol !== 'https:' && !(configured.protocol === 'http:' && local))) {
    throw new Error('APP_ORIGIN must be the public HTTPS origin or a loopback HTTP origin, without a trailing slash.');
  }
  origin = configured;
}
if (accounts && !['127.0.0.1','::1','localhost'].includes(bind) && origin?.protocol !== 'https:') {
  throw new Error('Set an HTTPS APP_ORIGIN before listening on a network interface.');
}
const server = createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host;
    const correctHost = accounts ? host === origin.host : /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host || '');
    if (!correctHost || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
      outgoing.writeHead(403).end();
      return;
    }
    const url = new URL(incoming.url, accounts ? origin : 'http://' + host);
    if (accounts && url.origin !== origin.origin) { outgoing.writeHead(403).end(); return; }
    const body = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 32768) { outgoing.writeHead(413).end(); return; }
      body.push(chunk);
    }
    if (size && ['GET','HEAD'].includes(incoming.method)) { outgoing.writeHead(400).end(); return; }
    const request = new Request(url,{method:incoming.method,headers:new Headers(incoming.headers),body:size ? Buffer.concat(body) : undefined});
    const response = await handleRequest(request,incoming.socket.remoteAddress || 'local');
    const headers = Object.fromEntries(response.headers);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    outgoing.writeHead(response.status,headers);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    outgoing.writeHead(500).end('The workspace could not load.');
  }
});
server.listen(port, bind, () => {
  const loopback = 'http://127.0.0.1:' + server.address().port;
  origin ||= new URL(loopback);
  handleRequest = createLocalApplication({DB,origin:origin.origin,accounts,env:process.env});
  console.log('TechWomen AZ: ' + origin.origin);
});

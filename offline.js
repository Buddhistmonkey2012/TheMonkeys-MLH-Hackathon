export function createOfflineApi(fixture, suggestions, storage, matches = () => []) {
  const storageKey = 'techwomen-az.demo.v1';
  const dateOffset = Date.now() - fixture.createdAt;
  const initial = structuredClone(fixture);
  for (const thread of initial.threads) {
    for (const message of thread.messages) message.created_at += dateOffset;
    for (const id of Object.keys(thread.read)) if (thread.read[id]) thread.read[id] += dateOffset;
    thread.updated_at += dateOffset;
  }
  for (const event of initial.events) {
    event.starts_at += dateOffset;
    event.ends_at += dateOffset;
  }
  let data = initial;
  function read() {
    try {
      const stored = JSON.parse((storage || globalThis.localStorage).getItem(storageKey));
      if (!stored) return;
      const people = stored.people.filter(p => p.isDemoAccount);
      const ids = new Set(people.map(p => p.id));
      data = {...stored,people,threads:stored.threads.filter(t => t.members.every(id => ids.has(id))),
        events:stored.events.filter(e => ids.has(e.owner_id)).map(e => ({...e,guests:e.guests.filter(id => ids.has(id))}))};
    } catch {}
  }
  function save() {
    try { (storage || globalThis.localStorage).setItem(storageKey,JSON.stringify(data)); } catch {}
  }
  function required(value, message) {
    if (!value) throw new Error(message);
    return value;
  }
  async function request(user, route, body = {}, params = {}) {
    read();
    if (route === 'demo-accounts') return {accounts:data.people.map(({id,name,role,username}) => ({id,name,role,username}))};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (route === 'demo-sign-in') {
      const account = data.people.find(p => p.id === body.person);
      required(account && email && (!account.email || email === account.email),'Enter the sample email for this account.');
      if (!account.email) {
        required(!data.people.some(p => p.email === email),'That sample email is already in use.');
        account.email = email;
        save();
      }
      return {id:account.id};
    }
    if (route === 'demo-register') {
      const name = required(typeof body.name === 'string' && body.name.trim().slice(0,60),'Enter a display name.');
      const role = ['Mentor','Mentee'].includes(body.role) ? body.role : 'Mentee';
      const username = String(body.username || '').trim().toLowerCase();
      required(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email),'Enter a sample email address.');
      required(!data.people.some(p => p.email === email),'That sample email is already in use.');
      required(/^[a-z0-9_]{3,24}$/.test(username),'Use 3–24 letters, numbers, or underscores for your username.');
      required(!data.people.some(p => p.username === username),'That username is already taken.');
      const id = crypto.randomUUID();
      data.people.push({id,name,username,email,role,focus:'',color:'lilac',isDemoAccount:true});
      save();
      return {id};
    }
    const profile = required(data.people.find(p => p.id === user),'Choose a demo profile.');
    if (route === 'profile') {
      const username = String(body.username || '').trim().toLowerCase();
      required(/^[a-z0-9_]{3,24}$/.test(username),'Use 3–24 letters, numbers, or underscores for your username.');
      required(!data.people.some(p => p.id !== user && p.username === username),'That username is already taken.');
      Object.assign(profile,{username,name:body.name,role:body.role,focus:body.focus});
      profile.intake = {preferred:body.preferred,style:body.style,format:body.format,story:body.story};
      save();
      return {saved:true};
    }
    const memberThreads = data.threads.filter(t => t.members.includes(user));
    const attending = e => e.owner_id === user || e.guests.includes(user);
    const now = Date.now();
    const thread = memberThreads.find(t => t.id === (params.id || body.thread));
    if (route === 'state') {
      return structuredClone({
        profile,people:data.people.map(({intake,email,...p}) => ({...p,name:intake?.preferred || p.name})),
        matches:matches(profile,data.people),ai:false,signedIn:{name:'Local demo',demoOnly:true},
        threads: memberThreads.map(t => ({
          id:t.id,title:t.title,updated_at:t.updated_at,members:t.members,preview:t.messages.at(-1)?.body,
          unread:t.messages.filter(m => m.author_id !== user && m.created_at > (t.read[user] || 0)).length,
        })).sort((a,b) => b.updated_at - a.updated_at),
        events:data.events.filter(e => e.visibility === 'Public' || attending(e))
          .map(e => attending(e) ? e : {...e,guests:[]}).sort((a,b) => a.starts_at - b.starts_at),
        readReminders:data.readReminders[user] || [],
      });
    }
    if (route === 'thread') return {messages:structuredClone(required(thread,'Conversation not found.').messages.slice(-200))};
    if (route === 'assistant') return {text:suggestions(required(thread,'Conversation not found.').messages,data.people,body.task),source:'template'};
    if (route === 'send' || route === 'read') {
      required(thread,'Conversation not found.');
      if (route === 'read') thread.read[user] = Math.max(thread.read[user] || 0, Math.min(body.through,now));
      else if (!thread.messages.some(m => m.id === body.id)) {
        thread.messages.push({id:body.id,author_id:user,body:required(body.message.trim(),'Enter a message.'),created_at:now});
        thread.updated_at = now;
      }
      save();
      return {saved:true};
    }
    if (route === 'new-thread') {
      const members = [...new Set([user,...body.people])];
      const roles = members.map(id => data.people.find(p => p.id === id)?.role);
      required(roles.includes('Mentor') && roles.includes('Mentee'),'Include at least one mentor and one mentee.');
      const title = (body.title || '').trim();
      required(members.length < 3 || title,'Give your group conversation a name.');
      const existing = memberThreads.find(t => t.id === body.requestId
        || (members.length === 2 && t.members.length === 2 && members.every(id => t.members.includes(id))));
      if (existing) return {id:existing.id};
      const id = body.requestId || crypto.randomUUID();
      data.threads.push({id,title,members,updated_at:now,messages:[],read:{}});
      save();
      return {id};
    }
    if (route === 'event') {
      const id = body.id || body.requestId || crypto.randomUUID();
      const owner = body.id ? required(data.events.find(e => e.id === id && e.owner_id === user),'Meeting not found.') : null;
      required(body.title.trim() && Number.isFinite(body.starts_at) && body.ends_at > body.starts_at,'Enter a title and an end time after the start.');
      if (body.format === 'Online' && body.location.trim()) {
        let link;
        try { link = new URL(body.location.trim()); } catch {}
        required(link?.protocol === 'https:', 'Enter an online meeting link starting with https://.');
      }
      const event = {
        id,owner_id:user,title:body.title.trim(),starts_at:body.starts_at,ends_at:body.ends_at,
        visibility:body.visibility,format:body.format,location:body.location.trim(),notes:(body.notes || '').trim(),
        guests:body.guests,reminder:body.reminder,
      };
      if (owner) data.events[data.events.indexOf(owner)] = event;
      else if (!data.events.some(e => e.id === id)) data.events.push(event);
      for (const person of Object.keys(data.readReminders)) data.readReminders[person] = data.readReminders[person].filter(value => value !== id);
      save();
      return {id};
    }
    if (route === 'delete-event' || route === 'dismiss') {
      const e = required(data.events.find(item => item.id === body.id && (route === 'dismiss' ? attending(item) : item.owner_id === user)),'Meeting not found.');
      if (route === 'dismiss') data.readReminders[user] = [...new Set([...(data.readReminders[user] || []),e.id])];
      else data.events = data.events.filter(item => item.id !== e.id);
      save();
      return {saved:true};
    }
    throw new Error('This action is available in the hosted workspace.');
  }
  return request;
}

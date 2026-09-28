// The browser stand-in for the desktop bridge: the page talks to the prism web server
// over one WebSocket, and every window.openghost method maps onto it.
(() => {
'use strict';
if (window.openghost) return;

const state = { ws: null, pending: new Map(), listeners: new Map(), seq: 0 };
let ready = null;

function connect() {
 ready = new Promise((resolve, reject) => {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = state.ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => resolve();
  ws.onclose = () => {
   for (const pending of state.pending.values()) pending.reject(new Error('connection lost'));
   state.pending.clear();
   setTimeout(connect, 700);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = event => {
   let msg;
   try { msg = JSON.parse(event.data); } catch { return; }
   if (msg.t === 'result' || msg.t === 'error') {
    const pending = state.pending.get(msg.id);
    state.pending.delete(msg.id);
    if (!pending) return;
    if (msg.t === 'result') pending.resolve(msg.value);
    else pending.reject(new Error(msg.error || 'request failed'));
   } else if (msg.t === 'event') {
    for (const callback of state.listeners.get(msg.channel) || []) {
     try { callback(...msg.args); } catch {}
    }
   }
  };
 });
}

const invoke = (channel, ...args) => {
 const id = ++state.seq;
 return ready.then(() => new Promise((resolve, reject) => {
  state.pending.set(id, { resolve, reject });
  state.ws.send(JSON.stringify({ t: 'invoke', id, channel, args }));
 }));
};
const send = (channel, ...args) => {
 ready.then(() => state.ws.send(JSON.stringify({ t: 'send', channel, args })));
};
const on = (channel, callback) => {
 const list = state.listeners.get(channel) || [];
 list.push(callback);
 state.listeners.set(channel, list);
};

connect();

window.openghost = {
 web: true,
 desktop: false,
 platform: 'web',
 pickFolder: () => {
  const path = window.prompt('Folder path for this chat:');
  if (!path) return null;
  const clean = path.replace(/[\\/]+$/, '');
  return { path: clean, name: clean.split(/[\\/]/).pop() || clean };
 },
 revealFolder: () => {},
 setTitleBar: () => {},
 notify: (title, body) => {
  try { new Notification(String(title || 'Prism'), { body: String(body || ''), icon: '/desktop/icon.png' }); } catch {}
 },
 store: {
  read: key => invoke('store:read', key),
  write: (key, value) => invoke('store:write', key, value),
  remove: key => invoke('store:remove', key),
 },
 tools: {
  run: (id, name, args, cwd) => invoke('tool:run', id, name, args, cwd),
  cancel: id => invoke('tool:cancel', id),
  environment: () => invoke('tool:environment'),
 },
 llm: {
  start: (id, request) => send('llm:start', id, request),
  abort: id => send('llm:abort', id),
  onEvent: callback => on('llm:event', callback),
  models: (provider, key) => invoke('llm:models', provider, key),
 },
 auth: {
  login: async () => ({ connected: false, error: 'sign-in works only in the desktop app' }),
  cancel: async () => ({ connected: false }),
  logout: async () => ({ connected: false }),
  status: async () => ({ connected: false }),
 },
 mcp: {
  status: () => invoke('mcp:status'),
  tools: () => invoke('mcp:tools'),
  call: (name, args) => invoke('mcp:call', name, args),
  reload: () => invoke('mcp:reload'),
  openConfig: () => invoke('mcp:open-config'),
  servers: () => invoke('mcp:servers'),
  save: (id, def) => invoke('mcp:save', id, def),
  remove: id => invoke('mcp:remove', id),
 },
 memory: {
  list: () => invoke('memory:list'),
  add: text => invoke('memory:add', text),
  update: (id, text) => invoke('memory:update', id, text),
  remove: id => invoke('memory:remove', id),
 },
 profile: {
  info: () => invoke('profile:info'),
  switch: async () => false,
 },
};
})();

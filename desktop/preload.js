'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openghost', {
 desktop: true,
 platform: process.platform,
 pickFolder: defaultPath => ipcRenderer.invoke('folder:pick', defaultPath),
 revealFolder: folder => ipcRenderer.invoke('folder:reveal', folder),
 setTitleBar: color => ipcRenderer.send('window:titlebar', color),
 notify: (title, body, summary) => ipcRenderer.send('notify', { title, body, summary }),
 store: {
  read: key => ipcRenderer.invoke('store:read', key),
  write: (key, value) => ipcRenderer.invoke('store:write', key, value),
  remove: key => ipcRenderer.invoke('store:remove', key),
 },
 tools: {
  run: (id, name, args, cwd) => ipcRenderer.invoke('tool:run', id, name, args, cwd),
  cancel: id => ipcRenderer.invoke('tool:cancel', id),
  environment: () => ipcRenderer.invoke('tool:environment'),
 },
 browser: {
  onEvent: callback => ipcRenderer.on('browser:event', (event, data) => callback(data)),
  shown: value => ipcRenderer.send('browser:shown', value),
 },
 profile: {
  info: () => ipcRenderer.invoke('profile:info'),
  switch: name => ipcRenderer.invoke('profile:switch', name),
 },
 skills: {
  list: directory => ipcRenderer.invoke('skills:list', directory),
 },
 instructions: {
  list: directory => ipcRenderer.invoke('instructions:list', directory),
  read: (directory, file) => ipcRenderer.invoke('instructions:read', directory, file),
  open: directory => ipcRenderer.invoke('instructions:open', directory),
 },
 discord: {
  get: () => ipcRenderer.invoke('discord:get'),
  set: patch => ipcRenderer.invoke('discord:set', patch),
  test: () => ipcRenderer.invoke('discord:test'),
 },
 memory: {
  list: () => ipcRenderer.invoke('memory:list'),
  add: text => ipcRenderer.invoke('memory:add', text),
  update: (id, text) => ipcRenderer.invoke('memory:update', id, text),
  remove: id => ipcRenderer.invoke('memory:remove', id),
 },
 mcp: {
  status: () => ipcRenderer.invoke('mcp:status'),
  tools: () => ipcRenderer.invoke('mcp:tools'),
  call: (name, args) => ipcRenderer.invoke('mcp:call', name, args),
  reload: () => ipcRenderer.invoke('mcp:reload'),
  openConfig: () => ipcRenderer.invoke('mcp:open-config'),
  servers: () => ipcRenderer.invoke('mcp:servers'),
  save: (id, def) => ipcRenderer.invoke('mcp:save', id, def),
  remove: id => ipcRenderer.invoke('mcp:remove', id),
 },
 llm: {
  start: (id, request) => ipcRenderer.send('llm:start', id, request),
  abort: id => ipcRenderer.send('llm:abort', id),
  onEvent: callback => ipcRenderer.on('llm:event', (event, data) => callback(data)),
  models: (provider, key) => ipcRenderer.invoke('llm:models', provider, key),
 },
 auth: {
  login: () => ipcRenderer.invoke('auth:login'),
  cancel: () => ipcRenderer.invoke('auth:cancel'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  status: () => ipcRenderer.invoke('auth:status'),
 },
});

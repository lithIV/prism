'use strict';

// Long-term memory: short facts the agent saves for later turns and other chats
// (the user's name, preferences, projects, things about itself). Lives in memory.json
// next to the rest of the app's data and stays on this computer.
const { app, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const file = () => path.join(app.getPath('userData'), 'memory.json');
let items = null;

function load() {
 if (items) return items;
 try {
  const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  items = Array.isArray(data?.items) ? data.items.filter(item => item?.id && typeof item.text === 'string') : [];
 } catch {
  items = [];
 }
 return items;
}

function save() {
 try {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ version: 1, items: load() }, null, 2));
 } catch {}
}

const list = () => load().map(({ id, text, created, updated }) => ({ id, text, created, updated }));

function add(text) {
 const value = String(text || '').trim();
 if (!value) return null;
 const now = Date.now();
 const item = { id: `mem_${crypto.randomBytes(4).toString('hex')}`, text: value.slice(0, 2000), created: now, updated: now };
 load().push(item);
 save();
 return item;
}

function update(id, text) {
 const item = load().find(entry => entry.id === id);
 if (!item) return null;
 item.text = String(text || '').slice(0, 2000);
 item.updated = Date.now();
 save();
 return item;
}

function remove(id) {
 const all = load();
 const at = all.findIndex(entry => entry.id === id);
 if (at >= 0) {
  all.splice(at, 1);
  save();
 }
 return list();
}

function register(fromApp) {
 ipcMain.handle('memory:list', event => (fromApp(event) ? list() : []));
 ipcMain.handle('memory:add', (event, text) => (fromApp(event) ? add(text) : null));
 ipcMain.handle('memory:update', (event, id, text) => (fromApp(event) ? update(id, text) : null));
 ipcMain.handle('memory:remove', (event, id) => (fromApp(event) ? remove(id) : []));
}

module.exports = { register, list, add, update, remove };

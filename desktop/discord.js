'use strict';

// Discord notifications: when a chat finishes, a bot sends the user a DM with the chat's
// name, the outcome and a one-line summary. Off by default; needs a bot token and the
// user's Discord id, both kept on this machine.
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const file = () => path.join(app.getPath('userData'), 'discord.json');
let prefs = null;

function load() {
 if (prefs) return prefs;
 try { prefs = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { prefs = {}; }
 return prefs || {};
}

function save() {
 try {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(load(), null, 2));
 } catch {}
}

function state() {
 const p = load();
 return { enabled: Boolean(p.enabled), userId: String(p.userId || ''), hasToken: Boolean(p.token) };
}

async function send(title, outcome, summary) {
 const p = load();
 if (!p.enabled || !p.token || !p.userId) return { ok: false, error: 'not configured' };
 try {
  const headers = { authorization: `Bot ${p.token}`, 'content-type': 'application/json' };
  const dm = await fetch('https://discord.com/api/v10/users/@me/channels', {
   method: 'POST',
   headers,
   body: JSON.stringify({ recipient_id: String(p.userId) }),
  });
  if (!dm.ok) return { ok: false, error: `dm channel ${dm.status}` };
  const channel = await dm.json();
  const content = `**${String(title).slice(0, 120)}** — ${String(outcome || 'completed')}${summary ? `\n${String(summary).slice(0, 400)}` : ''}`;
  const message = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
   method: 'POST',
   headers,
   body: JSON.stringify({ content }),
  });
  return { ok: message.ok, error: message.ok ? '' : `message ${message.status}` };
 } catch (error) {
  return { ok: false, error: String(error?.message || error).slice(0, 200) };
 }
}

function register(fromApp) {
 ipcMain.handle('discord:get', event => (fromApp(event) ? state() : { enabled: false, userId: '', hasToken: false }));
 ipcMain.handle('discord:set', (event, patch) => {
  if (!fromApp(event)) return state();
  const p = load();
  if (typeof patch?.token === 'string') p.token = patch.token.trim();
  if (typeof patch?.userId === 'string') p.userId = patch.userId.trim();
  if (typeof patch?.enabled === 'boolean') p.enabled = patch.enabled;
  prefs = p;
  save();
  return state();
 });
 ipcMain.handle('discord:test', event => (fromApp(event) ? send('Prism', 'test', 'Discord notifications are wired up.') : { ok: false }));
}

module.exports = { register, send, state };

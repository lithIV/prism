'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Tools = require('./tools');
const Browser = require('./browser');
const LLM = require('./llm');
const MCP = require('./mcp');
const Memory = require('./memory');
const Discord = require('./discord');

const APP_ID = 'com.prism.app';
// Profiles: prism --profile work keeps a separate workspace (chats, memory, keys, MCP config).
const PROFILE = (() => {
 const at = process.argv.indexOf('--profile');
 const value = at >= 0 ? String(process.argv[at + 1] || '').trim() : '';
 return /^[a-z0-9-]{1,24}$/.test(value.toLowerCase()) ? value.toLowerCase() : '';
})();
if (PROFILE) app.setPath('userData', app.getPath('userData') + '-' + PROFILE);
const ROOT = path.join(__dirname, '..');
// Windows takes the .ico; macOS and Linux take the .png.
const ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const CHAT_BG = '#191919';
const TITLE_BAR = { height: 36, symbolColor: '#9a9a9a' };
const STORE_KEY = /^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/;

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
app.setAppUserModelId(APP_ID);
nativeTheme.themeSource = 'dark';
Menu.setApplicationMenu(null);

function createShortcut() {
 const link = path.join(app.getPath('desktop'), 'Prism.lnk');
 const ok = shell.writeShortcutLink(link, 'create', {
  target: process.execPath,
  args: `"${ROOT}"`,
  cwd: ROOT,
  icon: ICON,
  iconIndex: 0,
  appUserModelId: APP_ID,
  description: 'Prism',
 });
 console.log(ok ? `Shortcut: ${link}` : 'Could not create the shortcut');
}

const storeDir = () => path.join(app.getPath('userData'), 'store');
const writes = new Map();

function storeFile(key) {
 if (typeof key !== 'string' || !STORE_KEY.test(key)) throw new Error(`Bad store key: ${key}`);
 return path.join(storeDir(), `${key}.json`);
}

async function readStore(key) {
 try {
  return JSON.parse(await fs.promises.readFile(storeFile(key), 'utf8'));
 } catch (error) {
  if (error.code === 'ENOENT') return null;
  throw error;
 }
}

function writeStore(key, value) {
 const file = storeFile(key), data = JSON.stringify(value);
 const next = (writes.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.promises.writeFile(temp, data, 'utf8');
  await fs.promises.rename(temp, file);
 });
 writes.set(file, next);
 next.finally(() => { if (writes.get(file) === next) writes.delete(file); }).catch(() => {});
 return next;
}

async function removeStore(key) {
 const file = storeFile(key);
 await (writes.get(file) || Promise.resolve()).catch(() => {});
 await fs.promises.rm(file, { force: true });
}

function external(url) {
 if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

function createWindow() {
 const win = new BrowserWindow({
  width: 1280,
  height: 840,
  minWidth: 760,
  minHeight: 540,
  show: false,
  title: 'Prism',
  icon: ICON,
  backgroundColor: CHAT_BG,
  // Linux window managers draw their own title bar; Windows and macOS get the app's own.
  ...(process.platform === 'linux' ? {} : {
   titleBarStyle: 'hidden',
   titleBarOverlay: { color: CHAT_BG, symbolColor: TITLE_BAR.symbolColor, height: TITLE_BAR.height },
  }),
  webPreferences: {
   preload: path.join(__dirname, 'preload.js'),
   contextIsolation: true,
   sandbox: true,
   spellcheck: true,
   webviewTag: true,
  },
 });
 win.once('ready-to-show', () => win.show());
 win.webContents.on('will-attach-webview', (event, prefs, params) => {
  if (!Browser.guard(win.webContents, prefs, params)) event.preventDefault();
 });
 win.webContents.on('did-attach-webview', (event, guest) => Browser.adopt(win.webContents, guest));
 win.webContents.setWindowOpenHandler(({ url }) => {
  external(url);
  return { action: 'deny' };
 });
 win.webContents.on('will-navigate', (event, url) => {
  if (url === win.webContents.getURL()) return;
  event.preventDefault();
  external(url);
 });
 win.webContents.on('before-input-event', (event, input) => {
  if (input.type !== 'keyDown') return;
  const key = input.key.toLowerCase();
  // Cmd on macOS, Ctrl elsewhere.
  const command = input.meta || input.control;
  if (key === 'f12' || (command && input.shift && key === 'i') || (input.meta && input.alt && key === 'i')) {
   win.webContents.toggleDevTools();
   event.preventDefault();
  } else if (key === 'f5' || (command && !input.shift && key === 'r')) {
   win.webContents.reload();
   event.preventDefault();
  }
 });
 win.loadFile(path.join(ROOT, 'app', 'index.html'));
 return win;
}

const INSTRUCTION_NAMES = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', 'INSTRUCTIONS.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md', '.claude/CLAUDE.md', '.opencode/AGENTS.md'];
const SKILL_SOURCES = () => [
 path.join(os.homedir(), '.claude', 'skills'),
];
function readSkill(file) {
 try {
  const text = fs.readFileSync(file, 'utf8').slice(0, 4000);
  const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() || path.basename(path.dirname(file));
  const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() || '';
  return { name, description: description.slice(0, 200), path: file };
 } catch {
  return null;
 }
}
ipcMain.handle('skills:list', (event, directory) => {
 if (!fromApp(event)) return [];
 const roots = [...SKILL_SOURCES()];
 if (typeof directory === 'string') roots.push(path.join(directory, '.claude', 'skills'));
 const out = [];
 for (const root of roots) {
  try {
   for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = readSkill(path.join(root, entry.name, 'SKILL.md'));
    if (skill) out.push(skill);
   }
  } catch {}
 }
 return out.slice(0, 60);
});

ipcMain.handle('instructions:list', (event, directory) => {
 if (!fromApp(event) || typeof directory !== 'string') return [];
 const found = [];
 for (const name of INSTRUCTION_NAMES) {
  try { if (fs.statSync(path.join(directory, name)).isFile()) found.push(name.replace(/\\/g, '/')); } catch {}
 }
 try {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
   if (entry.isFile() && /\.md$/i.test(entry.name) && !found.includes(entry.name)) found.push(entry.name);
   if (found.length >= 40) break;
  }
 } catch {}
 return found;
});
ipcMain.handle('instructions:read', (event, directory, file) => {
 if (!fromApp(event) || typeof directory !== 'string' || typeof file !== 'string') return null;
 const base = path.resolve(directory), target = path.resolve(base, file);
 if (!target.startsWith(base)) return null;
 try { return fs.readFileSync(target, 'utf8').slice(0, 20000); } catch { return null; }
});

ipcMain.handle('folder:pick', async (event, defaultPath) => {
 const win = BrowserWindow.fromWebContents(event.sender);
 const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory', 'promptToCreate'], ...(typeof defaultPath === 'string' && defaultPath ? { defaultPath } : {}) });
 if (result.canceled || !result.filePaths.length) return null;
 const folder = result.filePaths[0];
 await fs.promises.mkdir(folder, { recursive: true });
 return { path: folder, name: path.basename(folder) || folder };
});

ipcMain.handle('folder:reveal', (event, folder) => typeof folder === 'string' && shell.openPath(folder));
ipcMain.handle('store:read', (event, key) => readStore(key));
ipcMain.handle('store:write', (event, key, value) => writeStore(key, value));
ipcMain.handle('store:remove', (event, key) => removeStore(key));
ipcMain.on('window:titlebar', (event, color) => {
 const win = BrowserWindow.fromWebContents(event.sender);
 if (process.platform === 'linux') return;
 if (win && typeof win.setTitleBarOverlay === 'function' && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) win.setTitleBarOverlay({ color, symbolColor: TITLE_BAR.symbolColor, height: TITLE_BAR.height });
});

ipcMain.on('notify', (event, payload) => {
 const win = BrowserWindow.fromWebContents(event.sender);
 // Only when the window is not in front: an overnight run should reach the user, an open app should not buzz.
 if (!win || win.isFocused()) return;
 const title = typeof payload?.title === 'string' && payload.title.trim() ? payload.title.trim().slice(0, 120) : 'Prism';
 const body = typeof payload?.body === 'string' ? payload.body.slice(0, 200) : 'completed';
 try {
  new Notification({ title, body, icon: ICON, silent: false }).show();
 } catch {}
 // Optional: the same message as a Discord DM, when a bot token is configured.
 void Discord.send(title, body, payload?.summary).catch(() => {});
});

const fromApp = event => event.sender.getType() === 'window' && event.senderFrame?.url.startsWith('file:');
ipcMain.handle('tool:run', (event, id, name, args, cwd) => fromApp(event) ? Tools.runTool(id, name, args, cwd, event.sender) : { error: 'Not allowed' });
ipcMain.on('browser:shown', (event, value) => { if (fromApp(event)) Browser.setShown(value); });
ipcMain.handle('tool:cancel', (event, id) => { if (fromApp(event)) Tools.cancel(id); });
ipcMain.handle('tool:environment', event => fromApp(event) ? Tools.environment() : null);
LLM.register(fromApp);
MCP.register(fromApp);
Memory.register(fromApp);
Discord.register(fromApp);
ipcMain.handle('profile:info', event => {
 if (!fromApp(event)) return { name: PROFILE || 'default', profiles: [] };
 let profiles = [];
 try {
  profiles = fs.readdirSync(app.getPath('appData'), { withFileTypes: true })
   .filter(entry => entry.isDirectory() && (entry.name === 'Prism' || entry.name.startsWith('Prism-')))
   .map(entry => (entry.name === 'Prism' ? 'default' : entry.name.slice(6)))
   .filter(name => /^[a-z0-9-]{1,24}$/.test(name));
 } catch {}
 return { name: PROFILE || 'default', profiles: [...new Set(['default', PROFILE, ...profiles].filter(Boolean))] };
});
ipcMain.handle('profile:switch', (event, name) => {
 if (!fromApp(event)) return false;
 const target = String(name || '').toLowerCase() === 'default' ? '' : String(name || '').toLowerCase();
 if (target && !/^[a-z0-9-]{1,24}$/.test(target)) return false;
 const args = [];
 const argv = process.argv.slice(1);
 for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--profile') { i++; continue; }
  if (/^--profile=/.test(argv[i])) continue;
  args.push(argv[i]);
 }
 if (target) args.push('--profile', target);
 app.relaunch({ args });
 app.exit(0);
 return true;
});

if (process.argv.includes('--create-shortcut')) {
 app.whenReady().then(() => {
  createShortcut();
  app.quit();
 });
} else if (!app.requestSingleInstanceLock()) {
 app.quit();
} else {
 let win = null;
 app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
 });
 app.whenReady().then(() => {
  Browser.setup();
  win = createWindow();
  MCP.init().catch(() => {});
  win.on('closed', () => {
   win = null;
   Tools.cancelAll();
   LLM.cancelAll();
   MCP.stopAll();
  });
 });
 app.on('window-all-closed', () => app.quit());
 app.on('before-quit', event => {
  Tools.cancelAll();
  MCP.stopAll();
  if (!writes.size) return;
  event.preventDefault();
  Promise.allSettled([...writes.values()]).then(() => app.quit());
 });
}

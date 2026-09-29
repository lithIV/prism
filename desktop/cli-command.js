'use strict';

// Makes `prism` exist in any terminal: a small .cmd shim in the per-user WindowsApps folder,
// which is already on PATH on every Windows account. Running it without arguments opens the
// app; anything else goes to the command line tool (prism web, prism discord, …).
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const MARK = 'rem prism command';
const CLI = () => path.join(process.resourcesPath, 'app', 'tools', 'prism-cli.mjs');

// A prism command already on PATH somewhere else (an npm link, another install) is left alone.
function alreadyOnPath(ignore) {
 const names = ['prism.cmd', 'prism.bat', 'prism.exe', 'prism.ps1', 'prism'];
 const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
 return dirs.some(dir => {
  if (dir.toLowerCase() === ignore.toLowerCase()) return false;
  return names.some(name => { try { return fs.existsSync(path.join(dir, name)); } catch { return false; } });
 });
}

function install() {
 if (process.platform !== 'win32' || !app.isPackaged) return false;
 const dir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps') : '';
 if (!dir) return false;
 const file = path.join(dir, 'prism.cmd');
 const exe = process.execPath;
 try {
  if (fs.existsSync(file)) {
   const current = fs.readFileSync(file, 'utf8');
   // Somebody else's prism, or ours and up to date.
   if (!current.includes(MARK)) return false;
   if (current.includes(exe) && current.includes(CLI())) return false;
  } else if (alreadyOnPath(dir)) {
   return false;
  }
  fs.mkdirSync(dir, { recursive: true });
  const body = [
   '@echo off',
   `${MARK} (installed by the Prism app)`,
   `if "%~1"=="" (start "" "${exe}" & exit /b)`,
   `node "${CLI()}" %*`,
   '',
  ].join('\r\n');
  fs.writeFileSync(file, body);
  return true;
 } catch {
  return false;
 }
}

module.exports = { install };

'use strict';

// Looks at the GitHub releases of this repository when the app starts. A newer tag than the
// running version gets a plain dialog: download the Setup.exe and start it, or say Later.
const { app, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const REPO = 'lithium-ionic/prism';
const DELAY = 3500;      // let the window settle before the question
const TIMEOUT = 12000;

const parts = text => String(text).replace(/^v/i, '').split('.').map(part => parseInt(part, 10) || 0);
const isNewer = (a, b) => {
 const x = parts(a), y = parts(b);
 for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
 return false;
};

function request(url, headers = {}) {
 return new Promise((resolve, reject) => {
  const call = https.get(url, { headers: { 'User-Agent': 'Prism', Accept: 'application/vnd.github+json', ...headers } }, response => {
   if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.resume();
    request(response.headers.location, headers).then(resolve, reject);
    return;
   }
   if (response.statusCode !== 200) {
    response.resume();
    reject(new Error(`HTTP ${response.statusCode}`));
    return;
   }
   let body = '';
   response.setEncoding('utf8');
   response.on('data', chunk => { body += chunk; });
   response.on('end', () => resolve(body));
  });
  call.setTimeout(TIMEOUT, () => call.destroy(new Error('timed out')));
  call.on('error', reject);
 });
}

// The running version, or a stand-in when testing the flow on purpose.
const current = () => process.env.PRISM_UPDATE_TEST_VERSION || app.getVersion();

async function check() {
 const release = JSON.parse(await request(`https://api.github.com/repos/${REPO}/releases/latest`));
 const version = String(release?.tag_name || '').replace(/^v/i, '');
 if (!version || !isNewer(version, current())) return null;
 const asset = (release.assets || []).find(item => /setup\.exe$/i.test(item.name || ''));
 return { version, page: release.html_url, asset: asset ? { name: asset.name, url: asset.browser_download_url } : null };
}

function download(url, file, onProgress) {
 return new Promise((resolve, reject) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sink = fs.createWriteStream(`${file}.part`);
  const call = https.get(url, { headers: { 'User-Agent': 'Prism' } }, response => {
   if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    sink.close(); fs.rmSync(`${file}.part`, { force: true });
    download(response.headers.location, file, onProgress).then(resolve, reject);
    return;
   }
   if (response.statusCode !== 200) { sink.close(); reject(new Error(`HTTP ${response.statusCode}`)); return; }
   const total = Number(response.headers['content-length']) || 0;
   let got = 0;
   response.on('data', chunk => { got += chunk.length; onProgress?.(total ? got / total : 0); });
   response.pipe(sink);
   sink.on('finish', () => { sink.close(() => { fs.renameSync(`${file}.part`, file); resolve(file); }); });
  });
  call.setTimeout(TIMEOUT, () => call.destroy(new Error('timed out')));
  call.on('error', error => { sink.close(); reject(error); });
 });
}

async function install(info) {
 const win = require('electron').BrowserWindow.getAllWindows()[0] || null;
 const file = path.join(app.getPath('temp'), 'Prism-update', info.asset.name);
 const progress = win ? progress => win.setProgressBar(Math.max(0, Math.min(1, progress))) : null;
 await download(info.asset.url, file, progress);
 win?.setProgressBar(-1);
 await shell.openPath(file);
 // The installer replaces this very installation: step aside once it is up.
 setTimeout(() => app.quit(), 1500);
}

// Runs in the background; a failed check is only a quiet line in the log.
function start() {
 if (!app.isPackaged && !process.env.PRISM_UPDATE_TEST_VERSION) return;
 setTimeout(() => {
  check().then(async info => {
   if (!info) return;
   console.log(`[update] ${info.version} available (running ${current()})`);
   const win = require('electron').BrowserWindow.getAllWindows()[0] || null;
   const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Prism update',
    message: `Prism ${info.version} is available`,
    detail: `You are on ${current()}. Download it now? The installer starts when it is ready.`,
    buttons: ['Download and install', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
   });
   if (response !== 0) return;
   if (!info.asset) { shell.openExternal(info.page); return; }
   try {
    await install(info);
   } catch (error) {
    console.log('[update] download failed:', error.message);
    shell.openExternal(info.page);
   }
  }).catch(error => console.log('[update] check failed:', error.message));
 }, DELAY);
}

module.exports = { start, check, isNewer };

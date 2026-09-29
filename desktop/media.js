'use strict';

const { BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL, fileURLToPath } = require('node:url');

const VIEW = { side: 1280, quality: 0.82 };
const COUNT = { default: 8, view: 24, save: 600 };
const WAIT = { open: 20000, frame: 15000, image: 20000 };
const IMAGE_MAX = 64 * 1024 * 1024;
const IMAGE = /\.(png|jpe?g|jfif|pjpeg|webp|gif|bmp|ico|avif)$/i;
const MEDIA_ERRORS = {
 1: 'loading was aborted',
 2: 'the file could not be read',
 3: 'the video could not be decoded, the file may be damaged',
 4: 'its format or codec is not supported by the built-in decoder (mp4, webm, mov and mkv with H.264, VP8, VP9 or AV1 work)',
};

// Runs inside the helper page. Web security is off there, so canvases drawn from local files stay readable.
const PAGE = `(() => {
 const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
 const draw = (source, width, height, side, type, quality) => {
  const k = Math.min(1, side / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
 };
 const failure = () => new Error('media ' + (video?.error?.code || 0));
 let video = null;
 const seek = time => new Promise((resolve, reject) => {
  const done = () => { video.removeEventListener('error', fail); resolve(); };
  const fail = () => { video.removeEventListener('seeked', done); reject(failure()); };
  video.addEventListener('seeked', done, { once: true });
  video.addEventListener('error', fail, { once: true });
  video.currentTime = time;
 });
 const tasks = {
  async open(url) {
   video = document.createElement('video');
   video.muted = true;
   video.preload = 'auto';
   await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(failure());
    video.src = url;
   });
   let duration = video.duration;
   // Recorded WebM often has no duration in its header until the end is reached once.
   if (!Number.isFinite(duration)) { await seek(1e9); duration = video.duration; }
   let audio = null;
   try { audio = video.captureStream().getAudioTracks().length > 0; } catch {}
   return { duration: Number.isFinite(duration) ? duration : 0, width: video.videoWidth, height: video.videoHeight, audio };
  },
  async frame(time, side, quality, full) {
   await seek(time);
   const { videoWidth: width, videoHeight: height } = video;
   return {
    time: video.currentTime,
    view: side ? draw(video, width, height, side, 'image/webp', quality) : null,
    full: full ? draw(video, width, height, Infinity, 'image/png') : null,
   };
  },
  async image(url, side, quality) {
   const img = new Image();
   img.src = url;
   try { await img.decode(); } catch { throw new Error('image'); }
   return { width: img.naturalWidth, height: img.naturalHeight, url: draw(img, img.naturalWidth, img.naturalHeight, side, 'image/webp', quality) };
  },
 };
 window.media = async (name, args) => {
  try { return { ok: await tasks[name](...args) }; } catch (error) { return { error: error.message }; }
 };
})()`;

const plain = message => Object.assign(new Error(message), { plain: true });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isImage = file => IMAGE.test(file);

function call(contents, expression, ms, signal) {
 return new Promise((resolve, reject) => {
  const abort = () => reject(plain('Stopped by the user'));
  const timer = setTimeout(() => reject(plain('The decoder stopped responding')), ms);
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  contents.executeJavaScript(expression).then(resolve, reject).finally(() => {
   clearTimeout(timer);
   signal.removeEventListener('abort', abort);
  });
 });
}

// ------------------------------------------------------------ decoding without an Electron window
// The page above needs a window to draw in, and `prism web` has none: it stands in for Electron
// with a plain object, so `new BrowserWindow(...)` throws. When that happens ffmpeg/ffprobe do the
// same job — same shapes, same 1280 px cap, same data URLs. Set PRISM_FFMPEG or PRISM_FFPROBE to
// point at the binaries if they are not on PATH.
const TOOLS = {};
function locate(name) {
 if (TOOLS[name]) return TOOLS[name];
 const override = process.env[`PRISM_${name.toUpperCase()}`];
 if (override && fs.existsSync(override)) return (TOOLS[name] = override);
 const exts = (process.env.PATHEXT || '.EXE').split(';').filter(Boolean);
 for (const dir of (process.env.PATH || '').split(path.delimiter)) {
  if (!dir) continue;
  for (const ext of ['', ...exts]) {
   const candidate = path.join(dir, name + ext);
   try { if (fs.statSync(candidate).isFile()) return (TOOLS[name] = candidate); } catch {}
  }
 }
 return (TOOLS[name] = name);
}

function tool(name, args, { ms = WAIT.image, signal } = {}) {
 return new Promise((resolve, reject) => {
  const child = spawn(locate(name), args, { windowsHide: true });
  const out = [], err = [];
  let settled = false;
  const finish = (error, value) => {
   if (settled) return;
   settled = true;
   clearTimeout(timer);
   signal?.removeEventListener('abort', onAbort);
   try { child.kill(); } catch {}
   if (error) reject(error); else resolve(value);
  };
  const onAbort = () => finish(plain('Stopped by the user'));
  const timer = setTimeout(() => finish(plain('The decoder stopped responding')), ms);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  child.stdout.on('data', chunk => out.push(chunk));
  child.stderr.on('data', chunk => err.push(chunk));
  child.on('error', error => finish(error));
  child.on('close', code => {
   if (code === 0) return finish(null, Buffer.concat(out));
   const said = String(Buffer.concat(err)).trim().split(/\r?\n/).filter(Boolean).at(-1) || 'media 3';
   finish(Object.assign(plain(said), { media: true }));
  });
 });
}

async function probe(file, ms, signal) {
 const raw = await tool('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { ms, signal });
 const data = JSON.parse(String(raw)) || {};
 const streams = data.streams || [];
 const video = streams.find(stream => stream.codec_type === 'video') || {};
 const seconds = Number(data.format?.duration ?? video.duration);
 return {
  width: Number(video.width) || 0,
  height: Number(video.height) || 0,
  duration: Number.isFinite(seconds) ? seconds : 0,
  audio: streams.some(stream => stream.codec_type === 'audio'),
 };
}

// One frame as bytes: webp downscaled into a side-wide box, or the untouched full-size png.
function draw(file, { at, side, quality = VIEW.quality, png = false, ms, signal }) {
 const args = ['-v', 'error', '-nostdin'];
 if (at !== undefined) args.push('-ss', String(at));
 args.push('-i', file, '-frames:v', '1');
 if (png) args.push('-c:v', 'png', '-f', 'image2pipe', 'pipe:1');
 else args.push(
  '-vf', `scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease`,
  '-c:v', 'libwebp', '-quality', String(Math.round(quality * 100)), '-f', 'webp', 'pipe:1');
 return tool('ffmpeg', args, { ms, signal });
}

function ffmpegRun(signal) {
 let opened = '';
 // Stopping is the user's doing, not a broken file: never dress it up as a media error.
 const stopped = error => error.message === 'Stopped by the user' || error.message === 'The decoder stopped responding';
 return async (name, args, ms) => {
  if (name === 'open') {
   opened = fileURLToPath(args[0]);
   const info = await probe(opened, ms, signal)
    .catch(error => {
     if (stopped(error)) throw error;
     throw Object.assign(plain('media 4'), { media: true, cause: error });
    });
   if (!info.width) throw Object.assign(plain('media 3'), { media: true });
   return info;
  }
  if (name === 'image') {
   const file = fileURLToPath(args[0]);
   const [side, quality] = args.slice(1);
   try {
    const info = await probe(file, ms, signal);
    if (!info.width) throw plain('image');
    const bytes = await draw(file, { side, quality, ms, signal });
    return { width: info.width, height: info.height, url: `data:image/webp;base64,${bytes.toString('base64')}` };
   } catch (error) {
    if (stopped(error)) throw error;
    throw Object.assign(plain('image'), { media: true, cause: error });
   }
  }
  if (name === 'frame') {
   const [at, side, quality, full] = args;
   try {
    const out = { time: at, view: null, full: null };
    if (side) out.view = `data:image/webp;base64,${(await draw(opened, { at, side, quality, ms, signal })).toString('base64')}`;
    if (full) out.full = `data:image/png;base64,${(await draw(opened, { at, png: true, ms, signal })).toString('base64')}`;
    return out;
   } catch (error) {
    if (stopped(error)) throw error;
    throw Object.assign(plain('media 3'), { media: true, cause: error });
   }
  }
  throw Object.assign(plain('media 4'), { media: true });
 };
}

async function withPage(signal, work) {
 // No Electron means no canvas window; ffmpeg stands in and answers the same calls.
 if (typeof BrowserWindow !== 'function') return work(ffmpegRun(signal));
 const win = new BrowserWindow({
  show: false,
  width: 64,
  height: 64,
  skipTaskbar: true,
  focusable: false,
  webPreferences: { sandbox: true, contextIsolation: true, webSecurity: false, backgroundThrottling: false, spellcheck: false },
 });
 const contents = win.webContents;
 contents.setAudioMuted(true);
 contents.setWindowOpenHandler(() => ({ action: 'deny' }));
 contents.on('will-navigate', event => event.preventDefault());
 try {
  await win.loadURL('about:blank');
  await contents.executeJavaScript(PAGE);
  return await work(async (name, args, ms) => {
   const answer = await call(contents, `media(${JSON.stringify(name)}, ${JSON.stringify(args)})`, ms, signal);
   if (answer.error) throw Object.assign(plain(answer.error), { media: true });
   return answer.ok;
  });
 } finally {
  if (!win.isDestroyed()) win.destroy();
 }
}

function explainMedia(error, file) {
 if (!error.media) return error;
 const name = path.basename(file);
 if (error.message === 'image') return plain(`${name} can't be decoded as an image. PNG, JPEG, WebP, GIF, BMP, ICO and AVIF work; convert other formats first.`);
 const code = Number(error.message.split(' ')[1]);
 return plain(`${name} can't be opened as a video: ${MEDIA_ERRORS[code] || 'the decoder failed'}. For other formats install ffmpeg (winget install Gyan.FFmpeg), extract PNG frames with it and look at them with read_file.`);
}

async function stat(file) {
 const info = await fs.promises.stat(file).catch(error => { throw Object.assign(error, { file }); });
 if (info.isDirectory()) throw plain(`${file} is a folder`);
 return info;
}

function moments({ count, start, end, times }, duration, limit) {
 const last = Math.max(0, duration - 0.01);
 const list = Array.isArray(times) ? times.map(Number).filter(Number.isFinite) : [];
 if (list.length) return [...new Set(list.map(t => clamp(t, 0, last)))].sort((a, b) => a - b).slice(0, limit);
 const given = value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
 const from = clamp(given(start) ? Number(start) : 0, 0, duration);
 const to = clamp(given(end) ? Number(end) : duration, from, duration);
 const n = clamp(Math.round(Number(count)) || COUNT.default, 1, limit);
 if (to - from < 0.001) return [clamp(from, 0, last)];
 return Array.from({ length: n }, (_, k) => clamp(from + (k + 0.5) * (to - from) / n, 0, last));
}

function spread(length, max) {
 if (length <= max) return new Set(Array.from({ length }, (_, k) => k));
 return new Set(Array.from({ length: max }, (_, k) => Math.round(k * (length - 1) / (max - 1))));
}

async function frames(file, options, signal) {
 await stat(file);
 const saveTo = options.saveTo || '', limit = saveTo ? COUNT.save : COUNT.view;
 const asked = Array.isArray(options.times) && options.times.length ? options.times.length : Math.round(Number(options.count)) || COUNT.default;
 try {
  return await withPage(signal, async run => {
   const info = await run('open', [pathToFileURL(file).href], WAIT.open);
   if (!info.width) throw plain(`${path.basename(file)} has no picture, only sound`);
   const times = moments(options, info.duration, limit);
   const shown = spread(times.length, COUNT.view);
   const digits = String(times.length).length;
   if (saveTo) await fs.promises.mkdir(saveTo, { recursive: true });
   const out = [], files = [];
   for (let k = 0; k < times.length; k++) {
    if (signal.aborted) throw plain('Stopped by the user');
    const frame = await run('frame', [times[k], shown.has(k) ? VIEW.side : 0, VIEW.quality, !!saveTo], WAIT.frame);
    if (frame.view) out.push({ time: frame.time, url: frame.view });
    if (frame.full) {
     const name = `frame_${String(k + 1).padStart(Math.max(3, digits), '0')}_${frame.time.toFixed(2)}s.png`;
     await fs.promises.writeFile(path.join(saveTo, name), Buffer.from(frame.full.slice(frame.full.indexOf(',') + 1), 'base64'));
     files.push(name);
    }
   }
   return {
    path: file,
    ...info,
    frames: out,
    limited: asked > limit,
    saved: saveTo ? { folder: saveTo, count: files.length, first: files[0] || '', last: files.at(-1) || '' } : null,
   };
  });
 } catch (error) {
  throw explainMedia(error, file);
 }
}

async function image(file, signal) {
 const info = await stat(file);
 if (info.size > IMAGE_MAX) throw plain(`${path.basename(file)} is too big to look at`);
 try {
  const picture = await withPage(signal, run => run('image', [pathToFileURL(file).href, VIEW.side, VIEW.quality], WAIT.image));
  return { ...picture, bytes: info.size };
 } catch (error) {
  throw explainMedia(error, file);
 }
}

module.exports = { frames, image, isImage, COUNT };

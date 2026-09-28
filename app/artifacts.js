// Files the agent writes become small attachments under its message, with a preview
// (markdown renders, code shows as code) and a download that keeps the same filename.
(() => {
'use strict';

const escapeHtml = text => String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const nameOf = path => String(path || '').split(/[\\/]/).pop() || 'file';

async function read(path, cwd) {
 try {
  const out = await window.openghost?.tools?.run?.(`art-${Date.now().toString(36)}`, 'read_file', { path }, cwd);
  if (typeof out === 'string') return out;
  if (out && typeof out.text === 'string') return out.text;
  return null;
 } catch {
  return null;
 }
}

function previewModal(name, text) {
 const overlay = document.createElement('div');
 overlay.className = 'artifact-overlay';
 const card = document.createElement('div');
 card.className = 'artifact-modal';
 card.innerHTML = `<div class="artifact-head"><span class="artifact-title">${escapeHtml(name)}</span><button type="button" class="artifact-close" aria-label="Close">×</button></div><div class="artifact-viewport"></div>`;
 const view = card.querySelector('.artifact-viewport');
 if (/\.(md|markdown)$/i.test(name)) {
  const body = document.createElement('div');
  body.className = 'message-content markdown';
  view.append(body);
  StreamView.render(body, text);
 } else {
  const pre = document.createElement('pre');
  pre.className = 'artifact-pre';
  pre.textContent = text;
  view.append(pre);
 }
 const close = () => overlay.remove();
 card.querySelector('.artifact-close').addEventListener('click', close);
 overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
 const onKey = event => {
  if (event.key !== 'Escape') return;
  close();
  document.removeEventListener('keydown', onKey);
 };
 document.addEventListener('keydown', onKey);
 overlay.append(card);
 document.body.append(overlay);
}

window.Artifacts = {
 attach(container, { path, cwd }) {
  if (!container || !path || !window.openghost?.tools) return;
  const name = nameOf(path);
  const chip = document.createElement('div');
  chip.className = 'artifact';
  chip.innerHTML = `<span class="artifact-icon">${Glyphs.file}</span><span class="artifact-name" title="${escapeHtml(path)}">${escapeHtml(name)}</span><button type="button" class="artifact-btn" data-act="preview">Preview</button><button type="button" class="artifact-btn" data-act="download">Download</button>`;
  chip.querySelector('[data-act="preview"]').addEventListener('click', async () => {
   const text = await read(path, cwd);
   previewModal(name, text == null ? '(could not read the file)' : text);
  });
  chip.querySelector('[data-act="download"]').addEventListener('click', async () => {
   const text = await read(path, cwd);
   if (text == null) return;
   const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
   const url = URL.createObjectURL(blob);
   const link = document.createElement('a');
   link.href = url;
   link.download = name;
   link.click();
   setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  container.append(chip);
 },
};
})();

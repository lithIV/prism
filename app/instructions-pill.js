// A small pill beside the folder button: pick one instruction file for the folder, and the
// agent follows it in every chat in that folder — no swapping AGENTS.md by hand.
(() => {
'use strict';

const KEY = 'openghost.instructions';
const map = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = data => localStorage.setItem(KEY, JSON.stringify(data));
const escapeHtml = text => String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

class InstructionsPill {
 constructor({ button, menu, chat }) {
  this.button = button;
  this.menu = menu;
  this.chat = chat;
  button.addEventListener('click', () => this.open());
  menu.addEventListener('click', event => {
   const item = event.target.closest('[data-file]');
   if (item) this.choose(item.dataset.file || '');
  });
  this.sync();
 }

 folder() {
  const active = this.chat.active;
  if (!active) return '';
  // A draft keeps its own folder; an open chat keeps it on its record.
  return (active.record ? active.record.folder : active.folder?.path) || '';
 }

 chosen() {
  const folder = this.folder();
  return folder ? map()[folder] || '' : '';
 }

 sync() {
  if (!this.button) return;
  const folder = this.folder();
  this.button.hidden = !folder;
  if (!folder) return;
  const file = this.chosen();
  this.button.textContent = file ? file.split(/[\\/]/).pop() : I18n.t('instructions.pick');
  this.button.classList.toggle('is-on', Boolean(file));
  this.button.title = I18n.t('instructions.hint');
 }

 async open() {
  const folder = this.folder();
  if (!folder) return;
  let files = [];
  try { files = (await window.openghost?.instructions?.list?.(folder)) || []; } catch {}
  const current = this.chosen();
  this.menu.innerHTML = [
   `<div class="instructions-head">${escapeHtml(I18n.t('instructions.title'))}</div>`,
   `<button type="button" class="instructions-item${current ? '' : ' is-on'}" data-file="">${escapeHtml(I18n.t('instructions.none'))}</button>`,
   ...files.map(file => `<button type="button" class="instructions-item${file === current ? ' is-on' : ''}" data-file="${escapeHtml(file)}">${escapeHtml(file)}</button>`),
   files.length ? '' : `<div class="instructions-empty">${escapeHtml(I18n.t('instructions.empty'))}</div>`,
  ].join('');
  this.menu.showPopover?.();
 }

 choose(file) {
  const folder = this.folder();
  if (!folder) return;
  const data = map();
  if (file) data[folder] = file;
  else delete data[folder];
  save(data);
  this.menu.hidePopover?.();
  this.sync();
 }
}

window.InstructionsPill = InstructionsPill;
})();

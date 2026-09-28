// Parallel runs: the same prompt to several models at once, watched in a Runs tab of the
// right panel. Each run is a normal chat under the hood, so opening one shows everything.
(() => {
'use strict';

const runs = [];
const listeners = new Set();

window.ParallelRuns = {
 get runs() {
  return runs;
 },
 on(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
 },
 add(run) {
  runs.unshift(run);
  this.emit();
 },
 update(id, patch) {
  const run = runs.find(item => item.id === id);
  if (!run) return;
  Object.assign(run, patch);
  this.emit();
 },
 emit() {
  for (const callback of [...listeners]) {
   try { callback(); } catch {}
  }
 },
};

const STATUS_KEY = { running: 'runs.running', completed: 'runs.completed', failed: 'runs.failed', error: 'runs.error' };

// The trigger: a small popover over the composer with model checkboxes.
class ParallelPanel {
 constructor({ button, panel, chat, settings, composerText, pickFolder, consume }) {
  this.button = button;
  this.panel = panel;
  this.chat = chat;
  this.settings = settings;
  this.composerText = composerText;
  this.pickFolder = pickFolder;
  this.consume = consume;
  this.selected = new Set();
  this.busy = false;
  this.list = panel.querySelector('.parallel-models');
  this.runButton = panel.querySelector('.parallel-run');
  button.addEventListener('parallel-toggle', () => this.toggle());
  this.runButton.addEventListener('click', () => this.start());
  document.addEventListener('pointerdown', event => {
   if (!this.open) return;
   if (this.panel.contains(event.target) || this.button.contains(event.target)) return;
   this.panel.hidePopover?.();
  }, true);
 }

 get open() {
  return this.panel.matches(':popover-open');
 }

 toggle() {
  if (this.open) this.panel.hidePopover?.();
  else {
   this.render();
   this.panel.showPopover?.();
  }
 }

 render() {
  const models = this.settings.models || [];
  if (!this.selected.size) for (const model of models.slice(0, 2)) this.selected.add(model.id);
  this.list.innerHTML = models.map(model => `
   <label class="parallel-model">
    <input type="checkbox" data-model="${escapeAttr(model.id)}" ${this.selected.has(model.id) ? 'checked' : ''}>
    <span class="parallel-model-name">${escapeHtml(model.name || model.id)}</span>
    <span class="parallel-model-api">${escapeHtml(model.id)}</span>
   </label>`).join('');
  for (const input of this.list.querySelectorAll('input[data-model]')) {
   input.addEventListener('change', () => {
    if (input.checked) this.selected.add(input.dataset.model);
    else this.selected.delete(input.dataset.model);
    this.sync();
   });
  }
  this.sync();
 }

 sync() {
  const count = this.selected.size;
  this.runButton.disabled = !count;
  this.runButton.textContent = count > 1 ? I18n.t('parallel.runCount', { count }) : I18n.t('parallel.run');
 }

 async start() {
  if (this.busy) return;
  const models = (this.settings.models || []).filter(model => this.selected.has(model.id));
  const text = this.composerText.text().trim();
  if (!text || !models.length) return;
  this.busy = true;
  try {
   let folder = this.chat.folder;
   if (!folder && this.pickFolder) folder = await this.pickFolder();
   if (!folder) return;
   this.panel.hidePopover?.();
   await this.chat.runParallel(folder, models, text);
   this.consume?.();
  } finally {
   this.busy = false;
  }
 }
}

// The Runs tab in the right panel.
class RunsView {
 constructor({ chat }) {
  this.chat = chat;
  this.el = document.createElement('div');
  this.el.className = 'browser-view browser-runs';
  this.list = document.createElement('div');
  this.list.className = 'runs-list';
  this.el.append(this.list);
  this.off = window.ParallelRuns.on(() => this.render());
  this.render();
 }

 render() {
  const runs = window.ParallelRuns.runs;
  if (!runs.length) {
   this.list.innerHTML = `<div class="runs-empty">${escapeHtml(I18n.t('runs.empty'))}</div>`;
   return;
  }
  this.list.innerHTML = runs.map(run => `
   <button type="button" class="run-item" data-id="${escapeAttr(run.id)}">
    <span class="run-top"><span class="run-model">${escapeHtml(run.model || '')}</span><span class="run-status is-${escapeAttr(run.status)}">${escapeHtml(I18n.t(STATUS_KEY[run.status] || 'runs.running'))}</span></span>
    <span class="run-title">${escapeHtml(run.title || '')}</span>
    ${run.snippet ? `<span class="run-snippet">${escapeHtml(run.snippet)}</span>` : ''}
   </button>`).join('');
  for (const item of this.list.querySelectorAll('.run-item')) {
   item.addEventListener('click', () => this.chat.open(item.dataset.id));
  }
 }
}

function escapeHtml(text) {
 return String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}
function escapeAttr(text) {
 return escapeHtml(text).replace(/'/g, '&#39;');
}

window.ParallelPanel = ParallelPanel;
window.RunsView = RunsView;
})();

// Collapsible panel that shows the model's reasoning.
(() => {
'use strict';

class ThinkingView {
 constructor() {
  this.el = document.createElement('div');
  this.el.className = 'message-thinking';
  this.el.hidden = true;
  this.head = document.createElement('button');
  this.head.type = 'button';
  this.head.className = 'message-thinking-head';
  this.name = document.createElement('span');
  this.name.className = 'message-thinking-name';
  const chevron = document.createElement('span');
  chevron.className = 'message-thinking-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  this.head.append(this.name, chevron);
  this.body = document.createElement('div');
  this.body.className = 'message-thinking-body';
  this.inner = document.createElement('div');
  this.inner.className = 'message-thinking-inner';
  this.body.append(this.inner);
  this.el.append(this.head, this.body);
  this.open = false;
  this.touched = false;
  this.live = false;
  this.head.addEventListener('click', () => {
   this.touched = true;
   this.setOpen(!this.open);
  });
  window.addEventListener('effects-changed', event => {
   if (event.detail?.group === 'thinking' && this.el.isConnected) this.sync();
  });
  this.sync();
 }

 setOpen(open) {
  this.open = open;
  this.sync();
 }

 get extended() {
  return window.Effects?.thinkingMode === 'extended';
 }

 sync() {
  const extended = this.extended;
  // Extended: no header, no folding — the reasoning just stays on screen, as in a terminal.
  this.el.classList.toggle('is-extended', extended);
  this.head.hidden = extended;
  this.el.classList.toggle('is-open', extended || this.open);
  this.head.setAttribute('aria-expanded', String(this.open));
  this.name.textContent = I18n.t(this.live ? 'thinking.live' : 'thinking.done');
 }

 write(text, live) {
  this.live = Boolean(live);
  this.el.hidden = !text;
  this.inner.textContent = text || '';
  if (live && !this.touched) this.open = this.extended || window.Effects?.thinkingMode !== 'closed';
  this.sync();
  if (this.open) this.inner.scrollTop = this.inner.scrollHeight;
 }

 finish() {
  if (this.el.hidden) return;
  this.live = false;
  if (!this.touched) this.open = this.extended || window.Effects?.thinkingMode === 'open';
  this.sync();
 }
}

window.ThinkingView = ThinkingView;
})();

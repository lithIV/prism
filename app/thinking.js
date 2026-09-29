// Collapsible panel that shows the model's reasoning, with a clock beside it: how long the
// thinking has been going, and once it stops, how long it took.
(() => {
'use strict';

// Milliseconds under a second, seconds with a decimal under ten, then whole seconds,
// minutes, and hours — 840ms · 4.2s · 47s · 2m 05s · 1h 04m 12s.
const clock = ms => {
 if (ms < 1000) return `${Math.round(ms)}ms`;
 if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
 const total = Math.round(ms / 1000), pad = value => String(value).padStart(2, '0');
 const seconds = total % 60, minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3600);
 if (hours) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
 if (minutes) return `${minutes}m ${pad(seconds)}s`;
 return `${total}s`;
};

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
  this.time = document.createElement('span');
  this.time.className = 'message-thinking-time';
  this.time.hidden = true;
  this.head.append(this.time);
  this.el.append(this.head, this.body);
  this.open = false;
  this.touched = false;
  this.live = false;
  this.begun = 0;
  this.ticker = 0;
  this.head.addEventListener('click', () => {
   this.touched = true;
   this.setOpen(!this.open);
  });
  window.addEventListener('effects-changed', event => {
   if (event.detail?.group === 'thinking' && this.el.isConnected) this.sync();
  });
  this.sync();
 }

 // The clock lives in the header while it can be folded, and at the end of the text when the
 // box is extended and the header is gone.
 place() {
  if (this.extended) this.inner.after(this.time);
  else this.head.append(this.time);
 }

 start() {
  this.begun = performance.now();
  this.time.hidden = false;
  const tick = () => {
   if (!this.begun) return;
   this.time.textContent = clock(performance.now() - this.begun);
  };
  tick();
  clearInterval(this.ticker);
  this.ticker = setInterval(tick, 100);
 }

 stop() {
  clearInterval(this.ticker);
  this.ticker = 0;
  if (!this.begun) return;
  this.elapsed = performance.now() - this.begun;
  this.time.textContent = clock(this.elapsed);
  this.begun = 0;
  this.time.hidden = this.time.textContent === '';
 }

 // A restored message brings its own duration back.
 setTime(ms) {
  if (!ms) return;
  this.elapsed = ms;
  this.begun = 0;
  this.time.textContent = clock(ms);
  this.time.hidden = false;
  this.place();
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
  this.place();
  this.el.classList.toggle('is-open', extended || this.open);
  this.head.setAttribute('aria-expanded', String(this.open));
  this.name.textContent = I18n.t(this.live ? 'thinking.live' : 'thinking.done');
 }

 write(text, live) {
  const was = this.live;
  this.live = Boolean(live);
  this.el.hidden = !text;
  this.inner.textContent = text || '';
  if (live && !was) this.start();
  else if (!live && was) this.stop();
  if (live && !this.touched) this.open = this.extended || window.Effects?.thinkingMode !== 'closed';
  this.sync();
  if (this.open) this.inner.scrollTop = this.inner.scrollHeight;
 }

 finish() {
  if (this.el.hidden) return;
  this.live = false;
  this.stop();
  if (!this.touched) this.open = this.extended || window.Effects?.thinkingMode === 'open';
  this.sync();
 }
}

window.ThinkingView = ThinkingView;
})();

(() => {
'use strict';

// Press a picture to look at it properly: it opens over everything, at its own size,
// with pinch, wheel or a double tap to zoom and a drag to move around once zoomed.
// Escape, the close button or a click on the backdrop put it away again.

const ZOOM = { min: 1, max: 8, step: 1.0016, double: 2.5, out: 0.8 };
const DRAG = { slop: 4, swipe: 60 };
const TAP = { gap: 300, move: 8 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const label = (key, fallback) => (window.I18n && I18n.t ? I18n.t(key) : fallback);
const CHEVRON = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5"/></svg>';

class Lightbox {
 constructor() {
  this.images = [];
  this.index = 0;
  this.scale = 1;
  this.x = 0;
  this.y = 0;
  this.pointers = new Map();
  this.pinch = null;
  this.drag = null;
  this.tap = null;
  this.build();
 }

 build() {
  const el = this.el = document.createElement('div');
  el.className = 'lightbox';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', label('lightbox.label', 'Picture'));
  el.innerHTML = `
   <div class="lightbox-stage"><img class="lightbox-img" alt="" draggable="false"></div>
   <button type="button" class="lightbox-close" aria-label="${label('lightbox.close', 'Close')}"></button>
   <button type="button" class="lightbox-step is-prev" aria-label="${label('media.prev', 'Previous photo')}">${CHEVRON}</button>
   <button type="button" class="lightbox-step is-next" aria-label="${label('media.next', 'Next photo')}">${CHEVRON}</button>
   <span class="lightbox-zoom" aria-hidden="true"></span>`;
  this.stage = el.querySelector('.lightbox-stage');
  this.img = el.querySelector('.lightbox-img');
  this.zoom = el.querySelector('.lightbox-zoom');
  this.prev = el.querySelector('.is-prev');
  this.next = el.querySelector('.is-next');

  el.querySelector('.lightbox-close').addEventListener('click', () => this.close());
  this.prev.addEventListener('click', () => this.go(this.index - 1));
  this.next.addEventListener('click', () => this.go(this.index + 1));
  // A press on the backdrop, not on the picture, puts it away.
  this.stage.addEventListener('click', e => { if (e.target === this.stage) this.close(); });

  this.stage.addEventListener('pointerdown', e => this.onDown(e));
  this.stage.addEventListener('pointermove', e => this.onMove(e));
  this.stage.addEventListener('pointerup', e => this.onUp(e));
  this.stage.addEventListener('pointercancel', e => this.onUp(e));
  this.stage.addEventListener('wheel', e => this.onWheel(e), { passive: false });
  el.addEventListener('dblclick', e => { e.preventDefault(); this.toggle(e.clientX, e.clientY); });
  document.addEventListener('keydown', e => { if (!el.hidden) this.onKey(e); });

  const frame = () => { el.style.setProperty('--stage-w', `${this.stage.clientWidth}px`); };
  new ResizeObserver(frame).observe(this.stage);
  document.body.append(el);
 }

 open(images, index = 0) {
  if (!images || !images.length) return;
  this.images = images;
  this.el.hidden = false;
  this.el.classList.add('is-open');
  this.go(index);
  document.body.classList.add('has-lightbox');
 }

 close() {
  this.el.hidden = true;
  this.el.classList.remove('is-open');
  document.body.classList.remove('has-lightbox');
  this.img.removeAttribute('src');
  this.images = [];
  this.pointers.clear();
  this.pinch = null;
  this.drag = null;
 }

 go(i) {
  const index = clamp(i, 0, this.images.length - 1);
  this.index = index;
  const image = this.images[index];
  this.img.src = image.url;
  this.img.alt = image.name || '';
  this.reset();
  this.prev.disabled = index === 0;
  this.next.disabled = index === this.images.length - 1;
  this.el.classList.toggle('is-single', this.images.length < 2);
 }

 reset() {
  this.scale = 1;
  this.x = 0;
  this.y = 0;
  this.apply();
 }

 apply() {
  this.img.style.transform = `translate3d(${this.x.toFixed(2)}px, ${this.y.toFixed(2)}px, 0) scale(${this.scale.toFixed(4)})`;
  const percent = Math.round(this.scale * 100);
  this.zoom.textContent = percent > 100 ? `${percent}%` : '';
  this.stage.classList.toggle('is-zoomed', this.scale > 1.001);
 }

 // The middle of the stage stands in for the middle of the picture, so a zoom can hold
 // whatever sits under the finger or the cursor still: zoom about P, then move by d * (1 - k).
 center() {
  const box = this.stage.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
 }

 zoomTo(scale, px, py) {
  const next = clamp(scale, ZOOM.min, ZOOM.max);
  if (Math.abs(next - this.scale) < 0.0001) return;
  const k = next / this.scale, mid = this.center();
  const dx = (px === undefined ? mid.x : px) - mid.x;
  const dy = (py === undefined ? mid.y : py) - mid.y;
  this.x = dx * (1 - k) + k * this.x;
  this.y = dy * (1 - k) + k * this.y;
  this.scale = next;
  if (this.scale <= ZOOM.min + 0.0001) { this.scale = 1; this.x = 0; this.y = 0; }
  this.settle();
  this.apply();
 }

 // Never let the picture escape the stage entirely.
 settle() {
  const w = this.img.offsetWidth * this.scale, h = this.img.offsetHeight * this.scale;
  const box = this.stage.getBoundingClientRect();
  const roomX = Math.max(0, (w - box.width) / 2), roomY = Math.max(0, (h - box.height) / 2);
  this.x = clamp(this.x, -roomX, roomX);
  this.y = clamp(this.y, -roomY, roomY);
 }

 toggle(px, py) {
  if (this.scale > ZOOM.min + 0.001) this.reset();
  else this.zoomTo(ZOOM.double, px, py);
 }

 onDown(e) {
  this.stage.setPointerCapture(e.pointerId);
  this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (this.pointers.size === 2) {
   const [a, b] = [...this.pointers.values()];
   this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale, x: this.x, y: this.y };
   this.drag = null;
   return;
  }
  this.drag = { id: e.pointerId, from: this.x, fromY: this.y, x: e.clientX, y: e.clientY, moved: false, at: e.timeStamp };
  this.tap = this.tap && e.timeStamp - this.tap.at < TAP.gap ? this.tap : { at: e.timeStamp, x: e.clientX, y: e.clientY };
 }

 onMove(e) {
  const point = this.pointers.get(e.pointerId);
  if (!point) return;
  point.x = e.clientX;
  point.y = e.clientY;

  if (this.pinch && this.pointers.size >= 2) {
   const [a, b] = [...this.pointers.values()];
   const dist = Math.hypot(a.x - b.x, a.y - b.y);
   const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
   this.zoomTo(this.pinch.scale * (dist / Math.max(1, this.pinch.dist)), mid.x, mid.y);
   return;
  }

  const drag = this.drag;
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG.slop) return;
  drag.moved = true;
  this.stage.classList.add('is-panning');
  if (this.scale > ZOOM.min + 0.001) {
   this.x = drag.from + dx;
   this.y = drag.fromY + dy;
   this.settle();
   this.apply();
  } else {
   this.stage.style.setProperty('--swipe-x', `${dx}px`);
  }
 }

 onUp(e) {
  this.pointers.delete(e.pointerId);
  if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
  if (this.pointers.size < 2) this.pinch = null;
  const drag = this.drag;
  this.drag = null;
  this.stage.classList.remove('is-panning');
  this.stage.style.removeProperty('--swipe-x');
  if (!drag || e.pointerId !== drag.id) return;

  if (!drag.moved) {
   // A quick second press on the same spot means "closer", or "back to fit" again.
   if (this.tap && e.timeStamp - this.tap.at < TAP.gap) {
    const still = Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) < TAP.move;
    if (still) { this.tap = null; this.toggle(e.clientX, e.clientY); return; }
   }
   this.tap = { at: e.timeStamp, x: e.clientX, y: e.clientY };
   return;
  }

  this.tap = null;
  if (this.scale <= ZOOM.min + 0.001) {
   const dx = e.clientX - drag.x;
   if (Math.abs(dx) >= DRAG.swipe) this.go(this.index + (dx < 0 ? 1 : -1));
  }
 }

 onWheel(e) {
  if (e.ctrlKey || !e.deltaY) e.preventDefault();
  e.preventDefault();
  const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  this.zoomTo(this.scale * Math.pow(ZOOM.step, -step), e.clientX, e.clientY);
 }

 onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(this.index - 1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); this.go(this.index + 1); return; }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoomTo(this.scale * 1.4); return; }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); this.zoomTo(this.scale / 1.4); return; }
  if (e.key === '0') { e.preventDefault(); this.reset(); }
 }
}

const lightbox = new Lightbox();
window.Lightbox = {
 open: (images, index) => lightbox.open(images, index),
 close: () => lightbox.close(),
 get isOpen() { return !lightbox.el.hidden; },
};
})();

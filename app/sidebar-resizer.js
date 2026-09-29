// Drag the sidebar's edge to resize it; the width is remembered for the next visit.
// Double-clicking the handle puts the default width back.
(() => {
'use strict';

const KEY = 'openghost.sidebarWidth';
const MIN = 190;
const KEEP = 420;    // how much room the chat always keeps
const CAP = 560;     // and how fat the sidebar may grow on a huge screen

class SidebarResizer {
 constructor({ app, sidebar, handle }) {
  this.app = app;
  this.sidebar = sidebar;
  this.handle = handle;
  const stored = Number(localStorage.getItem(KEY));
  if (stored) this.apply(stored);
  handle.addEventListener('pointerdown', event => this.start(event));
  handle.addEventListener('dblclick', () => this.reset());
  window.addEventListener('resize', () => {
   const width = this.width();
   if (width) this.apply(width);
  });
 }

 limit(value) {
  return Math.max(MIN, Math.min(value, Math.min(CAP, innerWidth - KEEP)));
 }

 width() {
  const value = parseFloat(window.getComputedStyle(this.app).getPropertyValue('--sidebar-size'));
  return Number.isFinite(value) ? value : 0;
 }

 apply(value) {
  this.app.style.setProperty('--sidebar-size', `${Math.round(this.limit(value))}px`);
  window.browserPanel?.fit?.();
 }

 start(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  try { this.handle.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add('is-resizing-sidebar');
  this.sidebar.classList.add('is-resizing');
  const move = next => this.apply(next.clientX);
  const stop = () => {
   document.body.classList.remove('is-resizing-sidebar');
   this.sidebar.classList.remove('is-resizing');
   window.removeEventListener('pointermove', move);
   window.removeEventListener('pointerup', stop);
   window.removeEventListener('pointercancel', stop);
   localStorage.setItem(KEY, String(Math.round(this.width())));
  };
  move(event);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
 }

 reset() {
  localStorage.removeItem(KEY);
  this.app.style.removeProperty('--sidebar-size');
  window.browserPanel?.fit?.();
 }
}

window.SidebarResizer = SidebarResizer;
})();

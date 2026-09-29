(() => {
'use strict';

const LEAVE_TIME = 520;
const FLIGHT = {
 duration: 720,
 x: 'cubic-bezier(0.5, 0, 0.3, 1)',
 y: 'cubic-bezier(0.25, 0.7, 0.3, 1)',
 scale: 'cubic-bezier(0.45, 0, 0.3, 1)',
 tilt: 8,
};
const HANDOFF = { duration: 160, easing: 'ease', fill: 'forwards' };
const EYES = { x: 4, up: 2.4, down: 2.2, center: 0.49, reach: 90 };
const TYPING_GAZE = 1400;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

class WelcomeGhost {
 constructor({ main, root, input }) {
  this.main = main;
  this.root = root;
  this.flight = root.querySelector('.welcome-flight');
  this.ghost = null;
  this.shown = false;
  this.generation = 0;
  this.timer = 0;
  new MutationObserver(() => this.sync()).observe(main, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pointermove', event => this.lookAt(event.clientX, event.clientY), { passive: true });
  input.addEventListener('input', () => {
   if (this.shown) this.ghost?.look(0, EYES.down, TYPING_GAZE);
  });
  this.sync();
 }

 sync() {
  const empty = this.main.classList.contains('is-empty');
  if (empty === this.shown) return;
  this.shown = empty;
  if (empty) this.enter();
  else this.leave();
 }

 enter() {
  this.reset();
  this.ghost = document.createElement('ghost-thinking');
  this.flight.append(this.ghost);
  void this.root.offsetWidth;
  this.root.classList.add('is-shown');
 }

 leave() {
  const generation = this.generation, ghost = this.ghost, status = this.status();
  if (!ghost || reducedMotion()) { this.reset(); return; }
  if (!status) {
   this.root.classList.replace('is-shown', 'is-leaving');
   ghost.look(0, -EYES.up, LEAVE_TIME);
   this.timer = setTimeout(() => this.reset(), LEAVE_TIME);
   return;
  }
  this.root.classList.replace('is-shown', 'is-flying');
  status.classList.add('is-arriving');
  for (const animation of status.getAnimations()) animation.finish();
  const from = this.flight.getBoundingClientRect();
  const start = { x: from.left + from.width / 2, y: from.top + from.height / 2, size: from.width || 1 };
  const begun = performance.now();
  // The reply is still settling while the ghost flies, so the landing spot is read every frame:
  // aiming at where the status stood on the first frame lands the ghost somewhere else — the
  // teleport it used to do — while following it lands exactly on the mark.
  const tick = now => {
   if (generation !== this.generation) return;
   const t = Math.min(1, (now - begun) / FLIGHT.duration);
   const mark = status.querySelector('ghost-thinking');
   const to = mark ? mark.getBoundingClientRect() : null;
   const live = to && to.width ? to : null;
   const ease = power => 1 - Math.pow(1 - t, power);
   const dx = live ? (live.left + live.width / 2 - start.x) * ease(3) : 0;
   const dy = live ? (live.top + live.height / 2 - start.y) * (t * t * (3 - 2 * t)) : 0;
   const scale = live ? (start.size + (live.width - start.size) * ease(3)) / start.size : 1;
   this.root.style.translate = `${dx}px 0`;
   this.flight.style.translate = `0 ${dy}px`;
   this.flight.style.scale = String(scale);
   this.flight.style.rotate = `${Math.sign(dx || 1) * FLIGHT.tilt * Math.sin(Math.PI * t)}deg`;
   if (t < 1) { requestAnimationFrame(tick); return; }
   status.classList.remove('is-arriving');
   const len = Math.hypot(dx, dy) || 1;
   ghost.look(dx / len * EYES.x, dy / len * EYES.up, HANDOFF.duration);
   this.root.animate({ opacity: [1, 0] }, HANDOFF).finished.then(() => {
    if (generation === this.generation) this.reset();
   }).catch(() => {});
  };
  requestAnimationFrame(tick);
 }

 status() {
  const status = this.main.querySelector('.thread-list:not(.is-parked) > .message.is-assistant:last-child > .message-status');
  return status && !status.classList.contains('is-leaving') && status.querySelector('ghost-thinking') ? status : null;
 }

 reset() {
  this.generation++;
  clearTimeout(this.timer);
  for (const animation of this.root.getAnimations({ subtree: true })) animation.cancel();
  this.root.style.translate = '';
  this.flight.style.translate = '';
  this.flight.style.scale = '';
  this.flight.style.rotate = '';
  for (const status of this.main.querySelectorAll('.message-status.is-arriving')) status.classList.remove('is-arriving');
  this.root.classList.remove('is-shown', 'is-leaving', 'is-flying');
  this.ghost?.remove();
  this.ghost = null;
 }

 lookAt(x, y) {
  if (!this.shown || !this.ghost) return;
  const box = this.root.getBoundingClientRect();
  const dx = x - (box.left + box.width / 2), dy = y - (box.top + box.height * EYES.center);
  const len = Math.hypot(dx, dy) || 1, reach = len / (len + EYES.reach);
  this.ghost.look(dx / len * reach * EYES.x, dy / len * reach * (dy < 0 ? EYES.up : EYES.down));
 }
}

window.WelcomeGhost = WelcomeGhost;
})();

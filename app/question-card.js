// A question card with lettered choices (a, b, c…) and an always-available custom answer.
// The agent waits on the answer; picking a choice whose value is "build" leaves Plan mode.
// One option may be marked recommended: the card shows it and, after three minutes with no
// answer, picks it by itself so a wandering user cannot leave the agent waiting forever.
(() => {
'use strict';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
// How long the card waits before picking the recommended option on its own.
const AUTO_PICK = 180;

function element(tag, className, text) {
 const el = document.createElement(tag);
 el.className = className;
 if (text !== undefined) el.textContent = text;
 return el;
}

const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

class QuestionCard {
 static ask(info) {
  const card = new QuestionCard(info);
  return card.answer;
 }

 constructor(info) {
  this.settled = false;
  this.answer = new Promise(resolve => { this.resolve = resolve; });
  const options = (Array.isArray(info.options) ? info.options : []).slice(0, 6).map((option, index) => {
   if (typeof option === 'string') return { label: option, value: option };
   return { label: String(option?.label ?? option?.value ?? `Option ${index + 1}`), value: String(option?.value ?? option?.label ?? index), description: option?.description, recommended: Boolean(option?.recommended) };
  });

  const el = this.el = element('div', 'question-card');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', info.question);
  const head = element('div', 'question-head');
  head.append(element('span', 'question-title', info.question || 'A question'));
  el.append(head);

  const list = element('div', 'question-options');
  options.forEach((option, index) => {
   const row = element('button', 'question-option');
   row.type = 'button';
   row.classList.toggle('is-recommended', option.recommended);
   row.append(element('span', 'question-letter', LETTERS[index]));
   const body = element('span', 'question-body');
   const label = element('span', 'question-label');
   label.append(document.createTextNode(option.label));
   if (option.recommended) label.append(' ', element('span', 'question-recommended', I18n.t('ask.recommended')));
   body.append(label);
   if (option.description) body.append(element('span', 'question-note', option.description));
   row.append(body);
   row.addEventListener('click', () => this.settle(option.label, option.value));
   list.append(row);
  });
  el.append(list);

  const custom = element('div', 'question-custom');
  this.input = element('input', 'question-input');
  this.input.type = 'text';
  this.input.placeholder = I18n.t('ask.custom');
  const send = element('button', 'question-send', I18n.t('ask.send'));
  send.type = 'button';
  const submit = () => {
   const text = this.input.value.trim();
   if (text) this.settle(text, 'custom', text);
  };
  send.addEventListener('click', submit);
  this.input.addEventListener('keydown', event => {
   if (event.key === 'Enter') { event.preventDefault(); submit(); }
  });
  // A user who starts writing their own answer is present: the clock stops.
  this.input.addEventListener('input', () => { if (this.input.value.trim()) this.stopClock(); });
  custom.append(this.input, send);
  this.timer = null;
  const pick = options.find(option => option.recommended) || options[0];
  if (pick) {
   this.auto = pick;
   this.clock = element('span', 'question-timer');
   this.clock.title = I18n.t('ask.autoHint');
   this.clock.innerHTML = `<svg class="question-hg" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M3.2 1.4h5.6M3.2 10.6h5.6M3.8 1.4c0 2 1.9 2.7 1.9 4.6s-1.9 2.6-1.9 4.6M8.2 1.4c0 2-1.9 2.7-1.9 4.6s1.9 2.6 1.9 4.6"/></svg><span class="question-clock"></span>`;
   custom.append(this.clock);
   this.clockDown = this.clock.querySelector('.question-clock');
  }
  el.append(custom);

  const thread = document.querySelector('.thread-list:not(.is-parked)') || document.querySelector('.thread-list');
  (thread || document.body).append(el);
  el.scrollIntoView({ block: 'nearest' });
  requestAnimationFrame(() => this.input.focus({ preventScroll: true }));
  if (!reducedMotion()) {
   el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease' });
  }
  this.startClock();
 }

 startClock() {
  if (!this.auto || !this.clockDown) return;
  let left = AUTO_PICK;
  const paint = () => { this.clockDown.textContent = clock(left); };
  paint();
  this.timer = setInterval(() => {
   left -= 1;
   if (left <= 0) {
    this.stopClock();
    this.settle(this.auto.label, this.auto.value, '', true);
    return;
   }
   paint();
  }, 1000);
 }

 stopClock() {
  clearInterval(this.timer);
  this.timer = null;
  this.clock?.remove();
  this.clock = null;
  this.clockDown = null;
 }

 settle(label, value, custom = '', auto = false) {
  if (this.settled) return;
  this.settled = true;
  this.stopClock();
  this.el.classList.add('is-answered');
  for (const button of this.el.querySelectorAll('button')) button.disabled = true;
  this.input.disabled = true;
  this.resolve({ label, value, custom, auto });
  const el = this.el;
  if (reducedMotion()) { el.remove(); return; }
  el.animate([{ opacity: 1, height: `${el.offsetHeight}px` }, { opacity: 0, height: '0px', marginTop: '0px', marginBottom: '0px' }], { duration: 240, easing: 'ease', fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
 }
}

window.QuestionCard = QuestionCard;
})();

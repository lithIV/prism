// A question card with lettered choices (a, b, c…) and an always-available custom answer.
// The agent waits on the answer; picking a choice whose value is "build" leaves Plan mode.
(() => {
'use strict';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function element(tag, className, text) {
 const el = document.createElement(tag);
 el.className = className;
 if (text !== undefined) el.textContent = text;
 return el;
}

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
   return { label: String(option?.label ?? option?.value ?? `Option ${index + 1}`), value: String(option?.value ?? option?.label ?? index), description: option?.description };
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
   row.append(element('span', 'question-letter', LETTERS[index]));
   const body = element('span', 'question-body');
   body.append(element('span', 'question-label', option.label));
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
  custom.append(this.input, send);
  el.append(custom);

  const thread = document.querySelector('.thread-list:not(.is-parked)') || document.querySelector('.thread-list');
  (thread || document.body).append(el);
  el.scrollIntoView({ block: 'nearest' });
  requestAnimationFrame(() => this.input.focus({ preventScroll: true }));
  if (!reducedMotion()) {
   el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease' });
  }
 }

 settle(label, value, custom = '') {
  if (this.settled) return;
  this.settled = true;
  this.el.classList.add('is-answered');
  for (const button of this.el.querySelectorAll('button')) button.disabled = true;
  this.input.disabled = true;
  this.resolve({ label, value, custom });
  const el = this.el;
  if (reducedMotion()) { el.remove(); return; }
  el.animate([{ opacity: 1, height: `${el.offsetHeight}px` }, { opacity: 0, height: '0px', marginTop: '0px', marginBottom: '0px' }], { duration: 240, easing: 'ease', fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
 }
}

window.QuestionCard = QuestionCard;
})();

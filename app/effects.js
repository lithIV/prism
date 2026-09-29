// Interface preferences: the typing animation, and what thinking blocks and tool cards
// do while they run and after they finish. Read live by the components; saved locally.
(() => {
'use strict';

const KEY = 'openghost.effects';
const TYPING_MODES = ['both', 'deleting'];
const VIEW_MODES = ['auto', 'open', 'closed'];
// Thinking has two faces: the collapsible "Thought" row, or the extended box that is always
// shown with no header to close it. The old "open" setting grows into the extended box.
const THINKING_MODES = ['auto', 'extended'];
const THINKING = 'openghost.thinking';
const TOOLS = 'openghost.tools';

let mode = localStorage.getItem(KEY);
if (mode === 'typing') mode = 'both'; // the earlier four-mode values migrate
if (mode === 'none') mode = 'deleting';
if (!TYPING_MODES.includes(mode)) mode = 'both';

const readView = (key) => (VIEW_MODES.includes(localStorage.getItem(key)) ? localStorage.getItem(key) : 'auto');
const readThinking = () => {
 const stored = localStorage.getItem(THINKING);
 if (stored === 'open' || stored === 'closed') return stored === 'open' ? 'extended' : 'auto';
 return THINKING_MODES.includes(stored) ? stored : 'auto';
};
let thinkingMode = readThinking();
let toolsMode = readView(TOOLS);

window.Effects = {
 get mode() {
  return mode;
 },
 typing() {
  return mode === 'both';
 },
 deleting() {
  return true;
 },
 set(value) {
  if (!TYPING_MODES.includes(value)) return;
  mode = value;
  localStorage.setItem(KEY, value);
 },
 // "auto": expand while live, collapse when done · "open": never auto-collapse · "closed": never auto-expand
 get thinkingMode() {
  return thinkingMode;
 },
 get toolsMode() {
  return toolsMode;
 },
 setThinking(value) {
  if (!THINKING_MODES.includes(value)) return;
  thinkingMode = value;
  localStorage.setItem(THINKING, value);
  window.dispatchEvent(new CustomEvent('effects-changed', { detail: { group: 'thinking' } }));
 },
 setTools(value) {
  if (!VIEW_MODES.includes(value)) return;
  toolsMode = value;
  localStorage.setItem(TOOLS, value);
  window.dispatchEvent(new CustomEvent('effects-changed', { detail: { group: 'tools' } }));
 },
 modes: TYPING_MODES.slice(),
 viewModes: VIEW_MODES.slice(),
 thinkingModes: THINKING_MODES.slice(),
};
})();

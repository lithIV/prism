// Interface preferences: the typing animation, and what thinking blocks and tool cards
// do while they run and after they finish. Read live by the components; saved locally.
(() => {
'use strict';

const KEY = 'openghost.effects';
const TYPING_MODES = ['both', 'deleting'];
const VIEW_MODES = ['auto', 'open', 'closed'];
const THINKING = 'openghost.thinking';
const TOOLS = 'openghost.tools';

let mode = localStorage.getItem(KEY);
if (mode === 'typing') mode = 'both'; // the earlier four-mode values migrate
if (mode === 'none') mode = 'deleting';
if (!TYPING_MODES.includes(mode)) mode = 'both';

const readView = (key) => (VIEW_MODES.includes(localStorage.getItem(key)) ? localStorage.getItem(key) : 'auto');
let thinkingMode = readView(THINKING);
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
  if (!VIEW_MODES.includes(value)) return;
  thinkingMode = value;
  localStorage.setItem(THINKING, value);
 },
 setTools(value) {
  if (!VIEW_MODES.includes(value)) return;
  toolsMode = value;
  localStorage.setItem(TOOLS, value);
 },
 modes: TYPING_MODES.slice(),
 viewModes: VIEW_MODES.slice(),
};
})();

'use strict';

I18n.apply();

const app = document.querySelector('.app');
const sidebar = document.querySelector('.sidebar');
const sidebarToggle = document.querySelector('.sidebar-toggle');
const search = document.querySelector('.sidebar-search');
const searchButton = document.querySelector('.sidebar-search-button');
const searchInput = document.querySelector('.sidebar-search-input');
const main = document.querySelector('.main');
const thread = document.querySelector('.thread');
const composer = document.querySelector('.composer');
const composerField = document.querySelector('.composer-field');
const composerInput = document.querySelector('.composer-input');
const composerSend = document.querySelector('.composer-send');
const planButton = document.querySelector('.composer-plan');

let chatList = null;
let folderPill = null;
let modelStage = null;
let instructionsPill = null;
let effortSlider = null;

new SmoothHeight(composerField, composerInput);
new ResizeObserver(() => {
  const gap = parseFloat(getComputedStyle(main).getPropertyValue('--composer-bottom-gap')) || 0;
  main.style.setProperty('--composer-space', `${Math.ceil(composer.offsetHeight + gap)}px`);
}).observe(composer);
new Scrollbar(composerInput, document.querySelector('.composer-scrollbar'));
const threadScrollbar = new Scrollbar(thread, document.querySelector('.thread-scrollbar'));
new Scrollbar(document.querySelector('.chats-scroll'), document.querySelector('.chats-scrollbar'));
const composerText = new ComposerText(composerInput, document.querySelector('.composer-mirror'));
LinkChip.watch(document.querySelector('.composer-mirror'));
LinkChip.watch(thread);
const settings = new Settings(document.querySelector('.settings'));
new Scrollbar(document.querySelector('.settings-page'), document.querySelector('.settings-scrollbar')).observe(document.querySelector('.settings-providers'));
const threadBottom = document.querySelector('.thread-bottom');
new LiquidGlass(threadBottom, { width: 36, height: 36 });
const library = new Library(ChatStore, syncAll);
window.addEventListener('pagehide', () => library.flush());
const chat = new Chat({ main, thread, bottom: threadBottom, settings, library, onChange: syncAll, onList: list => threadScrollbar.observe(list) });
const lockScreen = new LockScreen({ main, chat, composer, onOpen: () => composerInput.focus({ preventScroll: true }) });
const lockCard = new LockCard({ chat, library, scroller: document.querySelector('.chats-scroll') });
new WelcomeGhost({ main, root: document.querySelector('.welcome'), input: composerInput });
folderPill = new FolderPill({ button: document.querySelector('.composer-folder'), library, chat });
instructionsPill = new InstructionsPill({ button: document.querySelector('.composer-instructions'), menu: document.querySelector('.instructions-menu'), chat });
planButton.addEventListener('click', () => chat.setAgentMode(chat.agentMode === 'plan' ? 'build' : 'plan'));
window.PrismPlan = { approve: () => chat.setAgentMode('build') };
window.__prismSubagent = (label, prompt) => chat.deploySubagent(prompt, label);
new ParallelPanel({
 button: document.querySelector('.composer-parallel'),
 panel: document.querySelector('.parallel-panel'),
 chat,
 settings,
 composerText,
 pickFolder: () => folderPill.pick(true),
 consume: () => {
  composerInput.value = '';
  composerText.refresh();
  clearDrafts();
  syncComposer();
 },
});
chatList = new ChatList({
  root: document.querySelector('.chats'),
  library,
  chat,
  onNewFolder: async () => {
    const folder = await library.pick();
    if (!folder) return;
    chat.newChat(folder);
    composerInput.focus();
  },
  onNewChat: (folder) => {
    chat.newChat(folder);
    composerInput.focus();
  },
  onLock: (id, row) => lockCard.open(id, row),
});
document.querySelector('.titlebar-name').innerHTML = `${Glyphs.ghost}<span>Prism</span>`;

// Live status under the composer: tokens used in this chat against the model's window.
{
 const node = document.querySelector('.composer-status-tokens');
 const human = value => (value >= 1000000 ? `${(value / 1000000).toFixed(2)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value || 0));
 setInterval(() => {
  if (!node) return;
  try {
   const context = chat.context();
   const tokens = context.tokens || 0;
   const windowSize = settings.windowOf(context.model || settings.model) || 0;
   const percent = windowSize ? Math.min(100, Math.round((tokens / windowSize) * 100)) : 0;
   const cache = context.cache;
   const cached = cache && cache.read + cache.write > 0 ? ` · cache ${human(cache.read)} read${cache.write ? ` / ${human(cache.write)} write` : ''}` : '';
   node.textContent = tokens ? `${human(tokens)} / ${human(windowSize)} tokens · ${percent}% · ${context.messages.length} messages${cached}` : '';
  } catch {}
 }, 1500);
}
const modeButton = document.querySelector('.composer-mode');
const browserToggle = document.querySelector('.browser-toggle');
let browserPanel = null;
if (AgentTools.available) {
  modeButton.hidden = false;
  new ModePicker({ button: modeButton, menu: document.querySelector('.mode-menu'), settings, onChange: () => chat.onModeChange() });
  if (window.openghost?.web) {
   browserToggle.hidden = true;
  } else {
   browserToggle.hidden = false;
   browserPanel = window.browserPanel = new BrowserPanel({ app, main, toggle: browserToggle });
   browserPanel.addRunsView(new RunsView({ chat }).el);
  }
}
const attachments = new Attachments({
  tray: document.querySelector('.composer-attachments'),
  picker: document.querySelector('.composer-picker'),
  panel: document.querySelector('.note-panel'),
  main,
  zone: document.querySelector('.drop-zone'),
  input: composerInput,
  onChange: syncComposer,
  isActive: () => !MiniChat.current && !chat.active?.locked,
});
new SelectionMenu({
  onAsk: (text, box) => {
    const mini = box.closest('.mini')?.__mini;
    if (mini) { mini.quote(text); return; }
    composerText.insertQuote(text);
    syncComposer();
  },
  onMini: text => MiniChat.open({ settings, source: chat, quote: text }),
});
document.querySelector('.composer-add').addEventListener('add', () => attachments.pick());
settings.show(chat.model);
modelStage = new ModelStage({
  button: document.querySelector('.composer-model'),
  root: document.querySelector('.model-stage'),
  chat,
  settings,
  input: composerInput,
});
effortSlider = new EffortSlider({
  button: document.querySelector('.composer-effort'),
  panel: document.querySelector('.effort-panel'),
  settings,
});
effortSlider.lock(chat.busy);

document.querySelector('.sidebar-settings').addEventListener('settings-open', () => settings.open());

document.querySelector('.sidebar-new-chat').addEventListener('add', () => {
  chat.newChat();
  composerInput.focus();
});

function setSidebarCollapsed(collapsed) {
  app.classList.toggle('is-sidebar-collapsed', collapsed);
  sidebarToggle.toggleAttribute('collapsed', collapsed);
  sidebar.inert = collapsed;
  browserPanel?.fit();
}

// On a phone — the web mode or a narrow window — the sidebar starts closed and slides over the chat.
const narrowScreen = () => window.matchMedia('(max-width: 820px)').matches;
if (narrowScreen()) setSidebarCollapsed(true);
app.addEventListener('click', event => {
  if (event.target === app && narrowScreen()) setSidebarCollapsed(true);
});
sidebar.addEventListener('click', event => {
  if (!narrowScreen()) return;
  // A row's own buttons and the rename field act in place; only opening a chat puts the sidebar away.
  if (event.target.closest('[data-action], .rename-input')) return;
  if (event.target.closest('.chat-row, .sidebar-new-chat')) setSidebarCollapsed(true);
});

sidebarToggle.addEventListener('sidebar-toggle', () => {
  setSidebarCollapsed(!app.classList.contains('is-sidebar-collapsed'));
});

const searchField = new SearchField({
  root: search,
  button: searchButton,
  input: searchInput,
  clear: document.querySelector('.sidebar-search-clear'),
});
searchInput.addEventListener('input', () => chatList.setQuery(searchInput.value));

document.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyK' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault();
  if (app.classList.contains('is-sidebar-collapsed')) setSidebarCollapsed(false);
  searchField.focus();
});

composer.addEventListener('mousedown', (event) => {
  if (event.target === composer || event.target.classList.contains('composer-toolbar')) {
    event.preventDefault();
    composerInput.focus();
  }
});

function syncComposer() {
  composerSend.toggleAttribute('disabled', !composerText.text().trim() && !attachments.count);
  composerField.classList.toggle('has-value', composerInput.value !== '');
}

const DRAFT = 'openghost.draft.';
const draftKey = () => DRAFT + (chat.active?.id || 'new');
let draftTimer = 0;
function saveDraft() {
 const text = composerText.text();
 const key = draftKey();
 if (text.trim()) localStorage.setItem(key, text);
 else localStorage.removeItem(key);
}
function restoreDraft() {
 const text = localStorage.getItem(draftKey());
 if (!text || composerText.text().trim()) return;
 composerInput.value = text;
 composerText.refresh();
 syncComposer();
}
function clearDrafts() {
 localStorage.removeItem(DRAFT + 'new');
 if (chat.active?.id) localStorage.removeItem(DRAFT + chat.active.id);
}

function syncAll() {
  if (!chatList) return;
  restoreDraft();
  syncComposer();
  folderPill.sync();
  chatList.render();
  lockScreen.sync();
  settings.show(chat.model);
  if (planButton) {
   planButton.hidden = !AgentTools.available;
   const plan = chat.agentMode === 'plan';
   planButton.textContent = I18n.t(plan ? 'plan.on' : 'plan.off');
   planButton.classList.toggle('is-on', plan);
   planButton.title = I18n.t(plan ? 'plan.hintOn' : 'plan.hintOff');
  }
  modelStage?.sync();
  instructionsPill?.sync();
  effortSlider?.lock(chat.busy);
}

async function send() {
  if (!composerText.text().trim() && !attachments.count) return;
  if (chat.needsFolder && !(await folderPill.pick(true))) {
    folderPill.nudge();
    return;
  }
  const text = composerText.text().trim();
  if ((!text && !attachments.count) || !chat.send(text, attachments.items)) return;
  attachments.take();
  composerInput.value = '';
  composerText.refresh();
  clearDrafts();
  syncComposer();
}

composerInput.addEventListener('input', syncComposer);

composerInput.addEventListener('input', () => {
 clearTimeout(draftTimer);
 draftTimer = setTimeout(saveDraft, 700);
});
window.addEventListener('pagehide', saveDraft);
setInterval(() => {
 if (composerText.text().trim()) saveDraft();
}, 4000);

composerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && chat.busy && !event.isComposing && !document.querySelector(':popover-open, dialog[open]')) {
    event.preventDefault();
    chat.stop();
    return;
  }
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
  event.preventDefault();
  send();
});

composerSend.addEventListener('composer-send', () => send());

syncComposer();

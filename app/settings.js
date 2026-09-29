(() => {
'use strict';

const STORAGE = { effort: 'deepseek.effort', mode: 'openghost.mode', model: 'openghost.model', catalog: 'openghost.catalog' };
const KEYS = { openai: 'openai.apiKey', anthropic: 'anthropic.apiKey', deepseek: 'deepseek.apiKey', 'opencode-go': 'opencode-go.apiKey' };
// The order providers appear in, in the settings and in the model picker.
const ORDER = ['opencode-go', 'chatgpt', 'openai', 'anthropic', 'deepseek'];
const DEFAULT_MODEL = 'deepseek-flash';
const EFFORTS = ['none', 'low', 'high', 'max'];
const DEFAULT_EFFORT = 'high';
const DEFAULT_CONTEXT = 1000000;
// Shown until a key loads the real list, so the picker works before the first check.
const KNOWN_DEEPSEEK = [
 { id: 'deepseek-flash', api: 'deepseek-flash', provider: 'deepseek', name: 'DeepSeek-V4.1-Flash', context: 1048576, efforts: EFFORTS, defaultEffort: DEFAULT_EFFORT, vision: true },
 { id: 'deepseek-v4-pro', api: 'deepseek-v4-pro', provider: 'deepseek', name: 'DeepSeek-V4-Pro', context: 1048576, efforts: EFFORTS, defaultEffort: DEFAULT_EFFORT, vision: false },
];
const LINKS = {
 openai: ['https://platform.openai.com/api-keys', 'platform.openai.com'],
 anthropic: ['https://console.anthropic.com/settings/keys', 'console.anthropic.com'],
 deepseek: ['https://platform.deepseek.com/api_keys', 'platform.deepseek.com'],
 'opencode-go': ['https://opencode.ai/console', 'opencode.ai/console'],
};
const MODES = ['ask', 'auto', 'full'];
const DEFAULT_MODE = 'ask';
const CHECK_DELAY = 400;

const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function keyRow(provider) {
 const [href, host] = LINKS[provider];
 const note = I18n.has(`settings.${provider}.note`) ? ` ${escapeHtml(I18n.t(`settings.${provider}.note`))}` : '';
 return `
  <div class="settings-row">
   <div class="settings-text">
    <label class="settings-label" for="settings-key-${provider}">${escapeHtml(I18n.t(`settings.${provider}.key`))}</label>
    <p class="settings-hint"><span>${escapeHtml(I18n.t(`settings.${provider}.hint`))}</span> <a href="${href}" target="_blank" rel="noopener noreferrer">${host}</a>.${note}</p>
   </div>
   <div class="settings-control">
    <input id="settings-key-${provider}" class="settings-key is-secret" data-provider="${provider}" type="text" placeholder="${provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}" autocomplete="off" spellcheck="false">
    <p class="settings-status" data-provider="${provider}" role="status"></p>
   </div>
  </div>`;
}

function accountRow() {
 return `
  <div class="settings-row">
   <div class="settings-text">
    <span class="settings-label">${escapeHtml(I18n.t('settings.chatgpt.label'))}</span>
    <p class="settings-hint">${escapeHtml(I18n.t('settings.chatgpt.hint'))}</p>
   </div>
   <div class="settings-control settings-account">
    <div class="settings-account-row">
     <span class="settings-account-who"></span>
     <button type="button" class="settings-button is-primary" data-action="login">${escapeHtml(I18n.t('settings.chatgpt.login'))}</button>
     <button type="button" class="settings-button" data-action="cancel">${escapeHtml(I18n.t('settings.chatgpt.cancel'))}</button>
     <button type="button" class="settings-button" data-action="logout">${escapeHtml(I18n.t('settings.chatgpt.logout'))}</button>
    </div>
    <p class="settings-status" data-provider="chatgpt" role="status"></p>
   </div>
  </div>`;
}

function section(id, name, rows) {
 return `
  <section class="provider" data-provider="${id}" aria-labelledby="provider-${id}">
   <header class="provider-head">
    <h3 class="provider-name" id="provider-${id}">${escapeHtml(name)}</h3>
    <span class="provider-models"></span>
    <span class="provider-state"></span>
   </header>
   ${rows}
  </section>`;
}

class Settings {
 constructor(dialog) {
  this.dialog = dialog;
  this.list = dialog.querySelector('.settings-providers');
  this.keys = Object.fromEntries(Object.entries(KEYS).map(([provider, key]) => [provider, localStorage.getItem(key) || '']));
  this.account = { connected: false };
  this.catalog = this.readCatalog();
  this.models = [];
  this.efforts = EFFORTS.slice();
  localStorage.removeItem('deepseek.model');
  this.model = localStorage.getItem(STORAGE.model) || DEFAULT_MODEL;
  this.shown = this.model;
  const effort = localStorage.getItem(STORAGE.effort);
  this.effort = typeof effort === 'string' && effort ? effort : DEFAULT_EFFORT;
  const mode = localStorage.getItem(STORAGE.mode);
  this.mode = MODES.includes(mode) ? mode : DEFAULT_MODE;
  this.checks = {};
  this.checked = new Set();
  // Keys saved in an earlier session count as working until a check says otherwise.
  this.accepted = new Set(Object.keys(KEYS).filter(provider => this.keys[provider]));
  this.build();
  this.paintMcp();
  this.paintEffects();
  this.collect();
  dialog.addEventListener('dismiss', () => dialog.close());
  this.refreshAll();
 }

 readCatalog() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE.catalog)) || {}; } catch {}
  return { chatgpt: [], openai: [], anthropic: [], 'opencode-go': [], ...saved, deepseek: saved.deepseek?.length ? saved.deepseek : KNOWN_DEEPSEEK.slice() };
 }

 saveCatalog() {
  try { localStorage.setItem(STORAGE.catalog, JSON.stringify(this.catalog)); } catch {}
 }

 connected(provider) {
  return provider === 'chatgpt' ? !!this.account.connected : !!this.keys[provider];
 }

 // The badge turns green only once the provider has taken the key, so a mistyped key never looks connected.
 working(provider) {
  return this.connected(provider) && (provider === 'chatgpt' || this.accepted.has(provider));
 }

 // The picker offers the models of every connected provider; with none connected it shows DeepSeek, the app's own default.
 collect() {
  const models = ORDER.filter(provider => this.connected(provider)).flatMap(provider => this.catalog[provider] || []);
  this.models = models.length ? models : KNOWN_DEEPSEEK.slice();
  this.paint();
 }

 find(id) {
  return this.models.find(item => item.id === id) || null;
 }

 // A chat keeps its own model; one that is no longer offered falls back to the model new chats get.
 // Chats started before this was fixed kept the provider's model name rather than the picker's id, so that name is looked up too.
 resolve(id) {
  if (id && this.find(id)) return id;
  const named = id && this.models.find(item => item.api === id);
  if (named) return named.id;
  return this.find(this.model) ? this.model : this.models[0]?.id || DEFAULT_MODEL;
 }

 configFor(id) {
  const model = this.find(id) || KNOWN_DEEPSEEK.find(item => item.id === id) || null;
  const provider = model?.provider || 'deepseek';
  const efforts = Array.isArray(model?.efforts) ? model.efforts : EFFORTS;
  const effort = efforts.length ? (efforts.includes(this.effort) ? this.effort : [model?.defaultEffort, DEFAULT_EFFORT].find(level => efforts.includes(level)) || efforts[efforts.length - 1]) : '';
  return {
   provider,
   model: model?.api || id,
   name: model?.name || id,
   key: this.keys[provider] || '',
   ready: this.connected(provider),
   effort,
   efforts,
   vision: model?.vision !== false,
   thinking: model?.thinking,
   output: model?.output,
  };
 }

 get config() {
  return this.configFor(this.resolve(this.model));
 }

 windowOf(id) {
  return this.find(id)?.context || DEFAULT_CONTEXT;
 }

 // The effort steps follow the model of the chat on screen.
 show(id) {
  if (id === this.shown) return;
  this.shown = id;
  this.applyEfforts();
 }

 applyEfforts() {
  const model = this.find(this.shown);
  const efforts = Array.isArray(model?.efforts) ? model.efforts : EFFORTS;
  const same = efforts.length === this.efforts.length && efforts.every((level, i) => level === this.efforts[i]);
  this.efforts = efforts.slice();
  if (!efforts.length) {
   // A model without thinking levels keeps the last choice for the models that have them.
   this.effort = '';
  } else if (!efforts.includes(this.effort)) {
   const fallback = [model?.defaultEffort, DEFAULT_EFFORT].find(level => efforts.includes(level));
   this.effort = fallback || efforts[Math.min(efforts.length - 1, 2)];
   localStorage.setItem(STORAGE.effort, this.effort);
  }
  if (!same) this.onEfforts?.(this.efforts);
 }

 setModel(id) {
  if (id === this.model || !this.find(id)) return;
  this.model = id;
  localStorage.setItem(STORAGE.model, id);
 }

 setEffort(value) {
  this.effort = value;
  localStorage.setItem(STORAGE.effort, value);
 }

 setMode(value) {
  if (!MODES.includes(value)) return;
  this.mode = value;
  localStorage.setItem(STORAGE.mode, value);
 }

 changed() {
  this.collect();
  this.applyEfforts();
  this.onModels?.();
 }

 async refreshAll() {
  await this.syncAccount();
  await Promise.all(Object.keys(KEYS).filter(provider => this.keys[provider]).map(provider => this.checkKey(provider)));
 }

 // A sign-in can lapse while the app runs, so the settings ask how it stands each time they open.
 async syncAccount() {
  const auth = window.openghost?.auth;
  if (!auth || this.account.waiting) return;
  const account = await auth.status().catch(() => null);
  if (account && !this.account.waiting) this.setAccount(account);
 }

 // Loads a provider's models into the catalog; the last request for a provider wins.
 async refresh(provider) {
  const token = (this.checks[provider] = (this.checks[provider] || 0) + 1);
  const models = await Providers.models(provider, this.keys[provider]);
  if (token !== this.checks[provider]) return false;
  this.catalog[provider] = models.length || provider !== 'deepseek' ? models : KNOWN_DEEPSEEK.slice();
  this.saveCatalog();
  this.changed();
  return true;
 }

 build() {
  this.list.innerHTML = [
   section('opencode-go', 'OpenCode Go', keyRow('opencode-go')),
   section('openai', 'OpenAI', accountRow() + keyRow('openai')),
   section('anthropic', 'Anthropic', keyRow('anthropic')),
   section('deepseek', 'DeepSeek', keyRow('deepseek')),
  ].join('');
  this.inputs = {};
  for (const input of this.list.querySelectorAll('.settings-key')) {
   const provider = input.dataset.provider;
   this.inputs[provider] = input;
   input.value = this.keys[provider];
   input.addEventListener('input', () => this.onKeyInput(provider));
  }
  this.statuses = Object.fromEntries([...this.list.querySelectorAll('.settings-status')].map(node => [node.dataset.provider, node]));
  this.accountBox = this.list.querySelector('.settings-account');
  this.accountBox.addEventListener('click', event => {
   const action = event.target.closest('[data-action]')?.dataset.action;
   if (action === 'login') this.login();
   else if (action === 'cancel') window.openghost?.auth?.cancel();
   else if (action === 'logout') this.logout();
  });
  if (!window.openghost?.auth) this.accountBox.closest('.settings-row').hidden = true;
  this.mcpPage = this.dialog.querySelector('.settings-mcp-page');
  this.tabs = [...this.dialog.querySelectorAll('.settings-tab')];
  this.pages = [...this.dialog.querySelectorAll('.settings-page')];
  for (const tab of this.tabs) tab.addEventListener('click', () => this.showTab(tab.dataset.tab));
 }

 paint() {
  if (!this.list) return;
  for (const node of this.list.querySelectorAll('.provider')) {
   const id = node.dataset.provider;
   if (id === 'mcp') continue;
   // OpenAI is connected through either the ChatGPT sign-in or a key; a model both offer counts once.
   const live = (id === 'openai' ? ['chatgpt', 'openai'] : [id]).filter(source => this.working(source));
   const on = live.length > 0, count = new Set(live.flatMap(source => this.catalog[source] || []).map(model => model.api)).size;
   const state = node.querySelector('.provider-state');
   state.textContent = I18n.t(on ? 'settings.connected' : 'settings.off');
   state.classList.toggle('is-on', on);
   node.querySelector('.provider-models').textContent = on && count ? I18n.t('settings.models', { count }) : '';
  }
  const box = this.accountBox;
  if (!box) return;
  box.dataset.state = this.account.waiting ? 'waiting' : this.account.connected ? 'connected' : 'idle';
  const who = [this.account.email, this.account.plan && I18n.t('settings.chatgpt.plan', { plan: this.account.plan.charAt(0).toUpperCase() + this.account.plan.slice(1) })].filter(Boolean).join(' · ');
  box.querySelector('.settings-account-who').textContent = this.account.waiting ? I18n.t('settings.chatgpt.waiting') : who;
 }

 showTab(name) {
  for (const tab of this.tabs || []) {
   if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
   else tab.removeAttribute('aria-current');
  }
  for (const page of this.pages || []) page.hidden = page.dataset.page !== name;
  const bar = document.querySelector('.settings-scrollbar');
  if (bar) bar.style.display = name === 'mcp' ? 'none' : '';
  if (name === 'mcp') this.paintMcp();
  if (name === 'effects') this.paintEffects();
  if (name === 'memory') this.paintMemory();
  if (name === 'about') this.paintAbout();
 }

 mcpNote(text, tone = '') {
  const node = this.mcpPage?.querySelector('.mcp-status');
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('is-error', tone === 'error');
 }

 async paintMemory() {
  const node = this.dialog.querySelector('.settings-memory-page');
  if (!node || !window.openghost?.memory) return;
  let memories = [];
  try { memories = (await window.openghost.memory.list()) || []; } catch {}
  // Oldest first: a memory the user adds here lands at the bottom, right above the field.
  memories.sort((a, b) => (a.created || 0) - (b.created || 0));
  node.innerHTML = `<div class="memory-list">${memories.length
   ? memories.map(item => `<div class="memory-row" data-id="${escapeHtml(item.id)}">
      <div class="memory-body">
       <div class="memory-text">${escapeHtml(item.text)}</div>
       <div class="memory-when">${escapeHtml(item.id)} · ${new Date(item.created || Date.now()).toLocaleDateString()}</div>
      </div>
      <button type="button" class="settings-button memory-remove" title="${escapeHtml(I18n.t('settings.memory.remove'))}">${escapeHtml(I18n.t('settings.memory.remove'))}</button>
     </div>`).join('')
   : `<div class="settings-mcp-empty">${escapeHtml(I18n.t('settings.memory.empty'))}</div>`}</div>
  <div class="memory-add-row">
   <input class="settings-key memory-input" placeholder="${escapeHtml(I18n.t('settings.memory.placeholder'))}" spellcheck="false">
   <button type="button" class="settings-button is-primary" data-memory-add>${escapeHtml(I18n.t('settings.memory.add'))}</button>
  </div>
  <p class="settings-status" data-provider="memory" role="status"></p>`;
  const add = async () => {
   const input = node.querySelector('.memory-input');
   const text = input?.value.trim();
   if (!text) return;
   await window.openghost?.memory?.add(text);
   await this.paintMemory();
  };
  node.querySelector('[data-memory-add]')?.addEventListener('click', add);
  node.querySelector('.memory-input')?.addEventListener('keydown', event => {
   if (event.key === 'Enter') add();
  });
  for (const row of node.querySelectorAll('.memory-row')) {
   row.querySelector('.memory-remove')?.addEventListener('click', async () => {
    await window.openghost?.memory?.remove(row.dataset.id);
    await this.paintMemory();
   });
  }
 }

 async paintAbout() {
  const node = this.dialog.querySelector('.settings-about-page');
  if (!node) return;
  let version = '';
  try { version = (await window.openghost?.app?.version?.()) || ''; } catch {}
  // Only the desktop app can fetch and run an installer; the web build just shows itself.
  const updatable = Boolean(window.openghost?.desktop && window.openghost?.update?.check);
  node.innerHTML = `
   <div class="about-hero">
    <span class="about-logo">${Glyphs.ghost}</span>
    <span class="about-title">
     <span class="about-name">Prism${version ? `<span class="about-version">${escapeHtml(version)}</span>` : ''}</span>
     <p class="settings-hint">${escapeHtml(I18n.t('settings.about.line'))}</p>
    </span>
   </div>
   ${updatable ? `<div class="settings-row">
    <div class="settings-text">
     <span class="settings-label">${escapeHtml(I18n.t('settings.about.updates'))}</span>
     <p class="settings-hint">${escapeHtml(I18n.t('settings.about.updatesHint'))}</p>
    </div>
    <div class="settings-control">
     <button type="button" class="settings-button is-primary" data-about-check>${escapeHtml(I18n.t('settings.about.check'))}</button>
    </div>
   </div>` : ''}
   <div class="settings-row">
    <div class="settings-text">
     <span class="settings-label">${escapeHtml(I18n.t('settings.about.repo'))}</span>
     <p class="settings-hint">${escapeHtml(I18n.t('settings.about.repoHint'))}</p>
    </div>
    <div class="settings-control">
     <a class="settings-button" href="https://github.com/lithIV/prism" target="_blank" rel="noopener noreferrer">github.com/lithIV/prism</a>
    </div>
   </div>
   <p class="settings-hint about-fine">${escapeHtml(I18n.t('settings.about.notice'))}</p>
   <p class="settings-status" data-provider="about" role="status"></p>`;
  node.querySelector('[data-about-check]')?.addEventListener('click', async () => {
   this.setStatus('about', I18n.t('settings.about.checking'));
   const result = await window.openghost.update.check().catch(() => null);
   if (result?.version) this.setStatus('about', I18n.t('settings.about.found', { version: result.version }));
   else if (result?.latest) this.setStatus('about', I18n.t('settings.about.latest', { version }));
   else this.setStatus('about', I18n.t('settings.about.failed'), 'error');
  });
 }

 async paintEffects() {
  const node = this.dialog.querySelector('.settings-effects-page');
  if (!node) return;
  const choice = (group, current, values, labels) => `<div class="effects-choice">${values.map(value => `<button type="button" class="settings-button${value === current ? ' is-primary' : ''}" data-effect-group="${group}" data-effect-value="${value}">${escapeHtml(labels[value])}</button>`).join('')}</div>`;
  const row = (labelKey, hintKey, choiceHtml) => `<div class="settings-row">
   <div class="settings-text">
    <span class="settings-label">${escapeHtml(I18n.t(labelKey))}</span>
    <p class="settings-hint">${escapeHtml(I18n.t(hintKey))}</p>
   </div>
   <div class="settings-control">${choiceHtml}</div>
  </div>`;
  const viewLabels = { auto: I18n.t('settings.effects.auto'), open: I18n.t('settings.effects.open'), closed: I18n.t('settings.effects.closed') };
  const thinkingLabels = { auto: I18n.t('settings.effects.auto'), extended: I18n.t('settings.effects.extended') };
  const typingLabels = { both: I18n.t('settings.effects.both'), deleting: I18n.t('settings.effects.deleting') };
  const effects = window.Effects;
let profile = { name: 'default', profiles: ['default'] };
  try { profile = (await window.openghost?.profile?.info?.()) || profile; } catch {}
  const profileBlock = `<div class="settings-row is-wide">
   <div class="settings-text">
    <span class="settings-label">${escapeHtml(I18n.t('settings.profile.title'))}</span>
    <p class="settings-hint">${escapeHtml(I18n.t('settings.profile.hint'))}</p>
   </div>
   <div class="settings-control">
    <div class="mcp-add-row">
     <select class="profile-select">${profile.profiles.map(name => `<option value="${escapeHtml(name)}"${name === profile.name ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>
     <input class="settings-key profile-input" placeholder="${escapeHtml(I18n.t('settings.profile.new'))}" spellcheck="false" autocomplete="off">
     <button type="button" class="settings-button is-primary" data-profile-switch>${escapeHtml(I18n.t('settings.profile.switch'))}</button>
    </div>
    <p class="settings-status" data-provider="profile" role="status"></p>
   </div>
  </div>`;
  let discord = { enabled: false, hasToken: false, userId: '' };
  try { discord = (await window.openghost?.discord?.get?.()) || discord; } catch {}
  const discordBlock = `<div class="settings-row is-wide">
   <div class="settings-text">
    <span class="settings-label">${escapeHtml(I18n.t('settings.discord.title'))}</span>
    <p class="settings-hint">${escapeHtml(I18n.t('settings.discord.hint'))}</p>
   </div>
   <div class="settings-control">
    <div class="mcp-add-row">
     <input class="settings-key discord-token" type="password" placeholder="${escapeHtml(discord.hasToken ? I18n.t('settings.discord.tokenSaved') : I18n.t('settings.discord.token'))}" autocomplete="off" spellcheck="false">
     <input class="settings-key discord-user" value="${escapeHtml(discord.userId)}" placeholder="${escapeHtml(I18n.t('settings.discord.user'))}" spellcheck="false">
    </div>
    <div class="mcp-add-row" style="margin-top:6px">
     <label class="mcp-auto"><input type="checkbox" class="discord-enabled" ${discord.enabled ? 'checked' : ''}>${escapeHtml(I18n.t('settings.discord.enable'))}</label>
     <button type="button" class="settings-button is-primary" data-discord-save>${escapeHtml(I18n.t('settings.discord.save'))}</button>
     <button type="button" class="settings-button" data-discord-test>${escapeHtml(I18n.t('settings.discord.test'))}</button>
    </div>
    <p class="settings-status" data-provider="discord" role="status"></p>
   </div>
  </div>`;
  node.innerHTML = [
   profileBlock,
   discordBlock,
   row('settings.effects.title', 'settings.effects.hint', choice('text', effects ? effects.mode : 'both', ['both', 'deleting'], typingLabels)),
   row('settings.effects.thinking', 'settings.effects.thinkingHint', choice('thinking', effects ? effects.thinkingMode : 'auto', ['auto', 'extended'], thinkingLabels)),
   row('settings.effects.tools', 'settings.effects.toolsHint', choice('tools', effects ? effects.toolsMode : 'auto', ['auto', 'open', 'closed'], viewLabels)),
  ].join('');
  node.querySelector('[data-discord-save]')?.addEventListener('click', async () => {
   const token = node.querySelector('.discord-token')?.value.trim();
   const userId = node.querySelector('.discord-user')?.value.trim() ?? '';
   const enabled = !!node.querySelector('.discord-enabled')?.checked;
   await window.openghost?.discord?.set?.({ ...(token ? { token } : {}), userId, enabled });
   this.setStatus('discord', I18n.t('settings.discord.saved'));
   this.paintEffects();
  });
  node.querySelector('[data-discord-test]')?.addEventListener('click', async () => {
   this.setStatus('discord', I18n.t('settings.discord.testing'));
   const result = await window.openghost?.discord?.test?.();
   this.setStatus('discord', result?.ok ? I18n.t('settings.discord.ok') : `${I18n.t('settings.discord.fail')} ${result?.error || ''}`, result?.ok ? '' : 'error');
  });
  node.querySelector('[data-profile-switch]')?.addEventListener('click', () => {
   const typed = node.querySelector('.profile-input')?.value.trim().toLowerCase();
   const name = typed || node.querySelector('.profile-select')?.value || 'default';
   if (name !== 'default' && !/^[a-z0-9-]{1,24}$/.test(name)) {
    this.setStatus('profile', I18n.t('settings.profile.bad'), 'error');
    return;
   }
   if (name === profile.name) {
    this.setStatus('profile', I18n.t('settings.profile.current'));
    return;
   }
   this.setStatus('profile', I18n.t('settings.profile.switching', { name }));
   window.openghost?.profile?.switch?.(name);
  });
for (const button of node.querySelectorAll('[data-effect-group]')) {
   button.addEventListener('click', () => {
    const { effectGroup, effectValue } = button.dataset;
    if (effectGroup === 'text') window.Effects?.set(effectValue);
    else if (effectGroup === 'thinking') window.Effects?.setThinking(effectValue);
    else if (effectGroup === 'tools') window.Effects?.setTools(effectValue);
    this.paintEffects();
   });
  }
 }

 async paintMcp() {
  const node = this.mcpPage;
  if (!node || !window.openghost?.mcp) return;
  const [data, tools] = await Promise.all([
   window.openghost.mcp.servers().catch(() => ({ servers: [] })),
   window.openghost.mcp.tools().catch(() => []),
  ]);
  const counts = {};
  for (const tool of tools) counts[tool.server] = (counts[tool.server] || 0) + 1;
  const cards = (data.servers || []).map(server => {
   const def = server.def || {};
   const tone = server.state === 'ready' ? 'is-on' : server.state === 'failed' ? 'is-bad' : '';
   const text = server.state === 'ready' ? I18n.t('settings.mcp.ready', { count: counts[server.id] ?? server.tools ?? 0 }) : I18n.t(`settings.mcp.${server.state}`);
   const target = def.type === 'remote' || def.url ? def.url || '' : (def.command || []).join(' ');
   return `<div class="mcp-card" data-id="${escapeHtml(server.id)}">
    <div class="mcp-card-head">
     <span class="mcp-card-name">${escapeHtml(server.id)}</span>
     <span class="settings-mcp-state ${tone}">${escapeHtml(text)}</span>
     <label class="mcp-auto"><input type="checkbox" data-mcp-auto ${def.autoApprove ? 'checked' : ''}>${escapeHtml(I18n.t('settings.mcp.auto'))}</label>
     <button type="button" class="settings-button" data-mcp-remove>${escapeHtml(I18n.t('settings.mcp.remove'))}</button>
    </div>
    <div class="mcp-card-detail" title="${escapeHtml(target)}">${escapeHtml(target)}</div>
    ${server.error ? `<div class="mcp-card-error">${escapeHtml(server.error)}</div>` : ''}
   </div>`;
  }).join('');
  node.innerHTML = `
   <div class="mcp-list">${cards || `<div class="settings-mcp-empty">${escapeHtml(I18n.t('settings.mcp.none'))}</div>`}</div>
   <div class="mcp-add">
    <div class="mcp-add-title">${escapeHtml(I18n.t('settings.mcp.addTitle'))}</div>
    <div class="mcp-add-row">
     <input class="settings-key mcp-add-name" placeholder="${escapeHtml(I18n.t('settings.mcp.namePlaceholder'))}" spellcheck="false" autocomplete="off">
     <select class="mcp-add-type"><option value="local">local</option><option value="remote">remote</option></select>
     <label class="mcp-auto"><input type="checkbox" class="mcp-add-auto">${escapeHtml(I18n.t('settings.mcp.auto'))}</label>
    </div>
    <div class="mcp-add-row">
     <input class="settings-key mcp-add-target" placeholder="${escapeHtml(I18n.t('settings.mcp.targetPlaceholder'))}" spellcheck="false" autocomplete="off">
     <button type="button" class="settings-button is-primary" data-mcp-add>${escapeHtml(I18n.t('settings.mcp.add'))}</button>
    </div>
    <div class="mcp-add-hint">${escapeHtml(I18n.t('settings.mcp.addHint'))} <a href="#" class="settings-mcp-open">${escapeHtml(I18n.t('settings.mcp.open'))}</a></div>
    <div class="mcp-status" role="status"></div>
   </div>`;
  for (const card of node.querySelectorAll('.mcp-card')) {
   const id = card.dataset.id;
   card.querySelector('[data-mcp-remove]')?.addEventListener('click', () => this.removeMcpServer(id));
   card.querySelector('[data-mcp-auto]')?.addEventListener('change', event => this.saveMcpServer(id, { autoApprove: event.target.checked }));
  }
  node.querySelector('[data-mcp-add]')?.addEventListener('click', () => this.addMcpServer());
  node.querySelector('.settings-mcp-open')?.addEventListener('click', event => { event.preventDefault(); window.openghost?.mcp?.openConfig(); });
 }

 async addMcpServer() {
  const node = this.mcpPage;
  if (!node || !window.openghost?.mcp) return;
  const name = node.querySelector('.mcp-add-name')?.value.trim();
  const type = node.querySelector('.mcp-add-type')?.value || 'local';
  const target = node.querySelector('.mcp-add-target')?.value.trim();
  const autoApprove = !!node.querySelector('.mcp-add-auto')?.checked;
  if (!name) return this.mcpNote(I18n.t('settings.mcp.needName'), 'error');
  if (!target) return this.mcpNote(I18n.t('settings.mcp.needTarget'), 'error');
  this.mcpNote(I18n.t('settings.mcp.startingNew'));
  try {
   await window.openghost.mcp.save(name, type === 'remote' ? { type: 'remote', url: target, autoApprove } : { type: 'local', command: target, autoApprove });
   await this.paintMcp();
   window.AgentTools?.refreshMcp?.();
   this.mcpNote('');
  } catch (error) {
   this.mcpNote(String(error?.message || error), 'error');
  }
 }

 async saveMcpServer(id, patch) {
  try {
   await window.openghost.mcp.save(id, patch);
   await this.paintMcp();
   window.AgentTools?.refreshMcp?.();
  } catch (error) {
   this.mcpNote(String(error?.message || error), 'error');
  }
 }

 async removeMcpServer(id) {
  try {
   await window.openghost.mcp.remove(id);
   await this.paintMcp();
   window.AgentTools?.refreshMcp?.();
  } catch (error) {
   this.mcpNote(String(error?.message || error), 'error');
  }
 }

 async reloadMcp() {
  if (!window.openghost?.mcp) return;
  this.mcpNote(I18n.t('settings.mcp.checking'));
  try {
   await window.openghost.mcp.reload();
   await this.paintMcp();
   window.AgentTools?.refreshMcp?.();
   this.mcpNote('');
  } catch (error) {
   this.mcpNote(String(error?.message || error), 'error');
  }
 }

 setAccount(account) {
  const was = this.account.connected;
  this.account = { connected: !!account?.connected, email: account?.email || '', plan: account?.plan || '' };
  if (account?.error) this.setStatus('chatgpt', account.error, 'error');
  if (this.account.connected && !this.catalog.chatgpt.length) this.refresh('chatgpt').catch(() => {});
  if (was !== this.account.connected) this.changed();
  else this.paint();
 }

 async login() {
  const auth = window.openghost?.auth;
  if (!auth || this.account.waiting) return;
  this.setStatus('chatgpt', '');
  this.account = { ...this.account, waiting: true };
  this.paint();
  const account = await auth.login();
  this.setAccount(account);
  // The badge turning green and the account line say it all; a "signed in" line under them would only repeat it.
  if (account?.connected) await this.refresh('chatgpt').catch(() => {});
 }

 async logout() {
  const auth = window.openghost?.auth;
  if (!auth) return;
  this.setAccount(await auth.logout());
  this.setStatus('chatgpt', '');
 }

 open(reason = '', provider = '') {
  if (!this.dialog.open) {
   this.dialog.showModal();
   this.dialog.focus();
   this.syncAccount();
   this.paintMcp();
  }
  if (reason) {
   const target = provider || 'deepseek';
   this.setStatus(target, reason, 'error');
   const field = target === 'chatgpt' ? this.accountBox.querySelector('[data-action="login"]') : this.inputs[target];
   field?.scrollIntoView({ block: 'center' });
   field?.focus();
   return;
  }
  for (const provider of Object.keys(KEYS)) {
   if (this.keys[provider] && !this.checked.has(provider)) this.checkKey(provider);
  }
 }

 onKeyInput(provider) {
  const key = this.inputs[provider].value.trim();
  this.keys[provider] = key;
  if (key) localStorage.setItem(KEYS[provider], key);
  else localStorage.removeItem(KEYS[provider]);
  clearTimeout(this.timer?.[provider]);
  this.timer = { ...this.timer };
  this.checked.delete(provider);
  this.accepted.delete(provider);
  if (!key) {
   this.setStatus(provider, '');
   this.changed();
   return;
  }
  this.paint();
  this.setStatus(provider, I18n.t('settings.key.checking'));
  this.timer[provider] = setTimeout(() => this.checkKey(provider), CHECK_DELAY);
 }

 // A working key shows only in the badge; the line under the field is for the check in progress and for what went wrong.
 async checkKey(provider) {
  const key = this.keys[provider];
  this.setStatus(provider, I18n.t('settings.key.checking'));
  try {
   const current = await this.refresh(provider);
   if (!current || key !== this.keys[provider]) return;
   this.accepted.add(provider);
   this.checked.add(provider);
   this.setStatus(provider, '');
  } catch (error) {
   if (key !== this.keys[provider]) return;
   this.accepted.delete(provider);
   this.setStatus(provider, error.message, 'error');
  }
  this.paint();
 }

 setStatus(provider, text, tone = '') {
  const node = this.statuses?.[provider];
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
 }
}

window.Settings = Settings;
})();

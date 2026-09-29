'use strict';

// OpenCode Go (opencode.ai/zen/go) serves a catalog of open coding models behind one API key.
// Most of them speak Chat Completions; Grok, GPT and Muse Spark speak the Responses API,
// and MiniMax and Qwen speak the Messages API, so those calls reuse the OpenAI and Anthropic
// engines pointed at the Go base URL.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('./openai');
const Claude = require('./anthropic');

const BASE = 'https://opencode.ai/zen/go/v1';
const MESSAGES_BASE = 'https://opencode.ai/zen/go';
const NO_VISION = '[A picture was here, but the selected model can\'t see pictures]';
const MAX_OUTPUT = 64000;

// How each family is served: the Responses API, the Messages API, or Chat Completions.
const RESPONSES = /^(grok-|gpt-|muse-spark)/;
const MESSAGES = /^(minimax-|qwen\d)/;

// What each model can actually do, from the OpenCode model catalog. The live copy in the
// OpenCode cache is preferred when present; this snapshot is the fallback. Each entry is
// [effort levels, can thinking be switched off].
const REASONING = {
 'deepseek-v4.1-flash': [['low', 'high', 'max'], true],
 'deepseek-v4-flash': [['low', 'high', 'max'], true],
 'deepseek-v4-pro': [['high', 'max'], true],
 'deepseek-v4-flash-vision-exp': [['low', 'high', 'max'], true],
 'deepseek-flash': [['low', 'high', 'max'], true],
 'gpt-6-luna': [['none', 'low', 'medium', 'high', 'xhigh', 'max'], false],
 'gpt-5.6-luna': [['none', 'low', 'medium', 'high', 'xhigh', 'max'], false],
 'grok-4.7': [['low', 'medium', 'high', 'xhigh'], false],
 'grok-4.6': [['low', 'medium', 'high', 'xhigh'], false],
 'grok-4.5': [['low', 'medium', 'high'], false],
 'kimi-k3': [['max'], false],
 'kimi-k2.7-code': [[], false],
 'kimi-k2.6': [[], false],
 'kimi-k2.5': [[], false],
 'glm-5.3-flash': [['low', 'high', 'max'], false],
 'glm-5.3': [['low', 'high', 'max'], false],
 'glm-5.2': [['high', 'max'], false],
 'glm-5.1': [[], false],
 'glm-5': [[], false],
 'qwen3.8-max': [['low', 'medium', 'xhigh'], true],
 'qwen3.8-flash': [['low', 'medium', 'xhigh'], true],
 'qwen3.7-max': [[], true],
 'qwen3.7-plus': [[], true],
 'qwen3.6-plus': [[], true],
 'qwen3.5-plus': [[], true],
 'longcat-2.0': [[], true],
 'longcat-2.5-preview-free': [[], true],
 'minimax-m3': [[], true],
 'minimax-m2.7': [[], false],
 'minimax-m2.5': [[], false],
 'mimo-v2.6-pro': [[], false],
 'mimo-v2.6-flash': [[], false],
 'mimo-v2.5-pro': [[], false],
 'mimo-v2.5': [[], false],
 'mimo-v2-pro': [[], false],
 'mimo-v2-omni': [[], false],
 'space-bunny-free': [['low', 'medium', 'high', 'xhigh', 'max'], false],
 'muse-spark-1.3-contributor': [['minimal', 'low', 'medium', 'high', 'xhigh'], false],
 'muse-spark-1.2-contributor': [['minimal', 'low', 'medium', 'high', 'xhigh'], false],
 'hy4-preview': [['none', 'high'], false],
 'hy3': [['none', 'low', 'high'], false],
 'hy3-preview': [[], false],
 'hy': [[], false],
 'omen-alpha': [['low', 'high'], false],
 'ox-alpha-free': [['low', 'high', 'max'], false],
};

// The OpenCode cache carries the same catalog and stays fresh as models come and go.
let cache;
function catalog() {
 if (cache !== undefined) return cache;
 cache = null;
 try {
  const file = path.join(os.homedir(), '.cache', 'opencode', 'models.json');
  cache = JSON.parse(fs.readFileSync(file, 'utf8'))?.['opencode-go']?.models || null;
 } catch {}
 return cache;
}

// The levels a model takes, and whether its thinking can be switched off entirely.
function reasoningOf(id) {
 const live = catalog()?.[id];
 let levels = null, toggle = false;
 if (live && Array.isArray(live.reasoning_options)) {
  const effort = live.reasoning_options.find(option => option?.type === 'effort');
  levels = effort && Array.isArray(effort.values) ? effort.values.slice() : [];
  toggle = live.reasoning_options.some(option => option?.type === 'toggle');
 }
 if (levels === null) {
  const snapshot = REASONING[id];
  if (snapshot) {
   levels = snapshot[0].slice();
   toggle = snapshot[1];
  }
 }
 if (levels === null) return { levels: [], toggle: false, known: false };
 // DeepSeek models take the thinking switch even where the catalog doesn't spell it out.
 if (/^deepseek/.test(id)) toggle = true;
 if (toggle && !levels.includes('none')) levels.unshift('none');
 return { levels, toggle, known: true };
}

function effortsOf(id) {
 const { levels } = reasoningOf(id);
 // "Default" always comes first: it means the model decides, nothing is sent.
 return levels.length ? ['default', ...levels] : [];
}

// The thinking switch and effort a model takes; "default" sends nothing at all.
function reasoningPayload(model, effort) {
 if (!effort || effort === 'default') return {};
 const { levels } = reasoningOf(model);
 if (!levels.includes(effort)) return {};
 const payload = {};
 if (/^deepseek/.test(model)) payload.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' };
 payload.reasoning_effort = effort;
 return payload;
}

// Display names for the ids the Go models endpoint returns.
const NAMES = {
 'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
 'deepseek-v4-pro': 'DeepSeek V4 Pro',
 'deepseek-v4-flash': 'DeepSeek V4 Flash',
 'deepseek-v4-flash-vision-exp': 'DeepSeek V4 Flash Vision (exp)',
 'deepseek-flash': 'DeepSeek Flash',
 'kimi-k3': 'Kimi K3',
 'kimi-k2.7-code': 'Kimi K2.7 Code',
 'kimi-k2.6': 'Kimi K2.6',
 'kimi-k2.5': 'Kimi K2.5',
 'glm-5.3-flash': 'GLM-5.3 Flash',
 'glm-5.3': 'GLM-5.3',
 'glm-5.2': 'GLM-5.2',
 'glm-5.1': 'GLM-5.1',
 'glm-5': 'GLM-5',
 'longcat-2.0': 'LongCat 2.0',
 'longcat-2.5-preview-free': 'LongCat 2.5 Preview (free)',
 'minimax-m3': 'MiniMax M3',
 'minimax-m2.7': 'MiniMax M2.7',
 'minimax-m2.5': 'MiniMax M2.5',
 'mimo-v2.6-pro': 'MiMo V2.6 Pro',
 'mimo-v2.6-flash': 'MiMo V2.6 Flash',
 'mimo-v2.5-pro': 'MiMo V2.5 Pro',
 'mimo-v2.5': 'MiMo V2.5',
 'mimo-v2-pro': 'MiMo V2 Pro',
 'mimo-v2-omni': 'MiMo V2 Omni',
 'qwen3.8-max': 'Qwen3.8 Max',
 'qwen3.8-flash': 'Qwen3.8 Flash',
 'qwen3.7-max': 'Qwen3.7 Max',
 'qwen3.7-plus': 'Qwen3.7 Plus',
 'qwen3.6-plus': 'Qwen3.6 Plus',
 'qwen3.5-plus': 'Qwen3.5 Plus',
 'grok-4.7': 'Grok 4.7',
 'grok-4.6': 'Grok 4.6',
 'grok-4.5': 'Grok 4.5',
 'gpt-6-luna': 'GPT-6 Luna',
 'gpt-5.6-luna': 'GPT-5.6 Luna',
 'muse-spark-1.3-contributor': 'Muse Spark 1.3 Contributor',
 'muse-spark-1.2-contributor': 'Muse Spark 1.2 Contributor',
 'hy4-preview': 'Hy4 preview',
 'hy3': 'Hy3',
 'hy3-preview': 'Hy3 preview',
 'hy': 'Hy',
 'space-bunny-free': 'Space Bunny (free)',
 'omen-alpha': 'Omen Alpha',
};

// Models that read pictures. The live catalog lists the input modalities, which is the truth;
// the model name is only a fallback for when the cache is missing. A model such as
// deepseek-v4.1-flash carries no "vision" in its name, so the name alone gets it wrong.
const VISION = /(vision|omni|^gpt-|^grok-|^muse-spark|qwen3\.8-flash)/;
function visionOf(id) {
 const live = catalog()?.[id];
 if (live) {
  if (Array.isArray(live.modalities?.input)) return live.modalities.input.includes('image');
  if (typeof live.attachment === 'boolean') return live.attachment;
 }
 return VISION.test(id);
}

const CONTEXT = id => {
 if (/^gpt-/.test(id)) return 1050000;
 if (/^deepseek/.test(id)) return 1048576;
 if (/^qwen3\.8-max/.test(id)) return 262144;
 if (/^grok-/.test(id)) return 200000;
 return 200000;
};

const pretty = id => NAMES[id] || id.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

function describe(id) {
 const efforts = effortsOf(id);
 return {
  id: `opencode-go:${id}`,
  provider: 'opencode-go',
  api: id,
  name: pretty(id),
  context: CONTEXT(id),
  vision: visionOf(id),
  efforts,
  defaultEffort: efforts.includes('high') ? 'high' : efforts[efforts.length - 1] || '',
  // The Messages models take a plain effort (or a thinking switch), no budget.
  thinking: MESSAGES.test(id) && efforts.length > 1 ? 'effort' : undefined,
 };
}

const error = (message, status = 0, code = '') => Object.assign(new Error(message), { status, code });

// The Go gateway routes requests by a stable per-conversation session id; the app has no
// such id of its own, so one is derived from the first user message of the history.
const crypto = require('node:crypto');
function sessionOf(request) {
 if (request.session) return String(request.session);
 const first = (request.messages || []).find(message => message.role === 'user');
 const seed = typeof first?.content === 'string' ? first.content : JSON.stringify(first?.content || '');
 return 'prism-' + crypto.createHash('sha1').update(seed || 'empty').digest('hex').slice(0, 24);
}

async function call(path, key, options = {}) {
 if (!/^[\x21-\x7e]+$/.test(key)) throw error('The OpenCode Go key is missing or malformed', 401);
 let response;
 try {
  response = await fetch(BASE + path, { ...options, headers: { Authorization: `Bearer ${key}`, ...options.headers } });
 } catch (cause) {
  if (cause.name === 'AbortError') throw cause;
  throw error('network', 0, 'network');
 }
 if (response.ok) return response;
 let detail = '';
 try {
  const body = await response.json();
  detail = body.error?.message || body.message || '';
 } catch {}
 throw error(detail || `OpenCode Go returned error ${response.status}`, response.status);
}

async function models({ key }) {
 cache = undefined; // a fresh listing re-reads the catalog
 const body = await (await call('/models', key)).json();
 return (body.data || []).filter(entry => entry?.id).map(entry => describe(entry.id));
}

// A text-only model rejects image parts, so pictures in the history turn into a short note instead.
function textOnly(messages) {
 return messages.map(message => {
  if (!Array.isArray(message.content)) return message;
  const content = message.content.map(part => part.type === 'image_url' ? NO_VISION : part.text || '').filter(Boolean).join('\n\n');
  return { ...message, content };
 });
}

async function chat(request, { signal, onEvent = () => {} }) {
 const { key, model, effort, vision = true, messages, tools, maxTokens } = request;
 const reasoning = reasoningPayload(model, effort);
 const response = await call('/chat/completions', key, {
  method: 'POST',
  signal,
  headers: { 'Content-Type': 'application/json', 'x-opencode-session': sessionOf(request) },
  body: JSON.stringify({
   model,
   // Blocks another provider left on a message mean nothing here.
   messages: (vision ? messages : textOnly(messages)).map(({ native, ...message }) => message),
   ...(tools?.length ? { tools } : {}),
   ...(maxTokens ? { max_tokens: maxTokens } : {}),
   stream: true,
   stream_options: { include_usage: true },
   ...reasoning,
  }),
 });
 const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
 const calls = [];
 const result = { finishReason: null, usage: null, content: '', reasoning: '', toolCalls: calls };
 let buffer = '';
 const done = () => {
  result.toolCalls = calls.filter(call => call?.function?.name);
  return result;
 };
 try {
  for (;;) {
   const { value, done: ended } = await reader.read();
   if (ended) break;
   buffer += value;
   const lines = buffer.split('\n');
   buffer = lines.pop();
   for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return done();
    let chunk;
    try {
     chunk = JSON.parse(data);
    } catch {
     continue;
    }
    if (chunk.error) throw error(chunk.error.message || 'OpenCode Go stopped the answer', Number(chunk.error.code) || 0);
    if (chunk.usage) result.usage = chunk.usage;
    const choice = chunk.choices && chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta || {};
    const thought = delta.reasoning_content || delta.reasoning;
    if (thought) {
     result.reasoning += thought;
     onEvent({ type: 'reasoning', delta: thought });
    }
    if (delta.content) {
     result.content += delta.content;
     onEvent({ type: 'content', delta: delta.content });
    }
    for (const part of delta.tool_calls || []) {
     const call = calls[part.index ?? calls.length] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
     if (part.id) call.id = part.id;
     if (part.function?.name) call.function.name += part.function.name;
     if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
    if (choice.finish_reason) result.finishReason = choice.finish_reason;
   }
  }
 } catch (cause) {
  if (cause.name === 'AbortError') throw Object.assign(cause, { partial: done() });
  throw cause;
 } finally {
  reader.cancel().catch(() => {});
 }
 return done();
}

async function stream(request, context) {
 // "Default" means the model decides: nothing is sent, whichever API it speaks.
 if (request.effort === 'default') request = { ...request, effort: '' };
 // Route by how the model is served; the Responses and Messages paths reuse the other engines.
 const session = sessionOf(request);
 if (RESPONSES.test(request.model)) {
  return OpenAI.stream({ ...request, provider: 'opencode-go' }, { ...context, apiUrl: BASE, extraHeaders: { 'x-opencode-session': session } });
 }
 if (MESSAGES.test(request.model)) {
  return Claude.stream(request, { ...context, baseURL: MESSAGES_BASE, defaultHeaders: { 'x-opencode-session': session } });
 }
 return chat(request, context);
}

module.exports = { models, stream, describe, MAX_OUTPUT };

'use strict';

// MCP servers for the agent: local (stdio) servers are spawned in the background, remote
// ones reached over HTTP. Servers live in mcp.json inside the app's data folder; the first
// time the file does not exist, the servers from an existing OpenCode install are imported.
const { app, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const CONNECT_TIMEOUT = 30000;
const CALL_TIMEOUT = 180000;
const MAX_ERROR = 400;
const CLEAN = /[^a-zA-Z0-9_-]/g;

const servers = new Map();
let importing = false;

const configPath = () => path.join(app.getPath('userData'), 'mcp.json');
const sanitize = name => String(name).replace(CLEAN, '_');
const snippet = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR);

function readJsonc(file) {
 try {
  const raw = fs.readFileSync(file, 'utf8')
   .replace(/^\s*\/\/.*$/gm, '')
   .replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(raw);
 } catch {
  return null;
 }
}

// Servers configured in an OpenCode install (global config), so an existing setup is not retyped.
function importFromOpenCode() {
 const out = {};
 const dir = path.join(os.homedir(), '.config', 'opencode');
 for (const name of ['opencode.json', 'opencode.jsonc']) {
  const data = readJsonc(path.join(dir, name));
  for (const [id, server] of Object.entries(data?.mcp || {})) {
   if (out[id] || server?.enabled === false) continue;
   if (Array.isArray(server?.command) && server.command.length) {
    out[id] = { type: 'local', command: server.command, ...(server.env ? { env: server.env } : {}), enabled: true };
   } else if (server?.url) {
    out[id] = { type: 'remote', url: server.url, enabled: true };
   }
  }
 }
 return out;
}

function loadConfig() {
 const file = configPath();
 if (!fs.existsSync(file)) {
  importing = true;
  const data = { servers: importFromOpenCode() };
  try {
   fs.mkdirSync(path.dirname(file), { recursive: true });
   fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}
  return data;
 }
 return readJsonc(file) || { servers: {} };
}

const withTimeout = (promise, ms, message) =>
 Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
 ]);

async function startLocal(id, entry, def) {
 const [command, ...args] = def.command;
 const transport = new StdioClientTransport({
  command,
  args,
  env: { ...process.env, ...(def.env || {}) },
  cwd: def.cwd ? path.resolve(def.cwd) : undefined,
  stderr: 'pipe',
 });
 const log = [];
 transport.stderr?.on('data', chunk => {
  log.push(String(chunk));
  if (log.length > 20) log.shift();
 });
 const client = new Client({ name: 'prism', version: app.getVersion() }, { capabilities: {} });
 try {
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT, `no answer within ${CONNECT_TIMEOUT / 1000}s`);
 } catch (error) {
  entry.error = `${snippet(error?.message)}${log.length ? ` — ${snippet(log.join(' '))}` : ''}`;
  try { await client.close(); } catch {}
  throw error;
 }
 entry.client = client;
}

async function startRemote(id, entry, def) {
 const transport = new StreamableHTTPClientTransport(new URL(def.url));
 const client = new Client({ name: 'prism', version: app.getVersion() }, { capabilities: {} });
 try {
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT, `no answer within ${CONNECT_TIMEOUT / 1000}s`);
 } catch (error) {
  entry.error = snippet(error?.message);
  try { await client.close(); } catch {}
  throw error;
 }
 entry.client = client;
}

function readConfig() {
 try {
  return readJsonc(configPath()) || { servers: {} };
 } catch {
  return { servers: {} };
 }
}

function writeConfig(data) {
 fs.mkdirSync(path.dirname(configPath()), { recursive: true });
 fs.writeFileSync(configPath(), JSON.stringify(data, null, 2));
}

// Splits a typed command line into argv, honouring quotes: node "C:\\my server\\index.js" --flag
function splitCommand(text) {
 const out = [];
 const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
 let match;
 while ((match = re.exec(String(text || '')))) out.push(match[1] ?? match[2] ?? match[3]);
 return out;
}

function serversInfo() {
 const config = readConfig();
 const defs = config.servers || {};
 const ids = [...new Set([...Object.keys(defs), ...servers.keys()])];
 return {
  configPath: configPath(),
  servers: ids.map(id => {
   const entry = servers.get(id);
   return {
    id,
    def: defs[id] || null,
    state: entry?.state || 'disabled',
    error: entry?.error || '',
    tools: (entry?.tools || []).length,
   };
  }),
 };
}

async function saveServer(id, patchDef) {
 const name = String(id || '').trim();
 if (!name) throw new Error('a server needs a name');
 const config = readConfig();
 config.servers = config.servers || {};
 const merged = { ...(config.servers[name] || {}), ...(patchDef || {}) };
 const clean = { enabled: merged.enabled !== false };
 if (merged.autoApprove) clean.autoApprove = true;
 const remote = merged.type === 'remote' || (merged.url && !merged.command);
 if (remote) {
  const url = String(merged.url || '').trim();
  if (!url) throw new Error('a remote server needs a URL');
  clean.type = 'remote';
  clean.url = url;
 } else {
  const command = Array.isArray(merged.command) ? merged.command : splitCommand(merged.command);
  if (!command.length) throw new Error('a local server needs a command');
  clean.type = 'local';
  clean.command = command;
 }
 config.servers[name] = clean;
 writeConfig(config);
 await init();
 return serversInfo();
}

async function removeServer(id) {
 const config = readConfig();
 if (config.servers?.[id]) {
  delete config.servers[id];
  writeConfig(config);
 }
 await init();
 return serversInfo();
}

async function startServer(id, def) {
 const entry = { id, state: 'starting', error: '', tools: [], auto: Boolean(def?.autoApprove) };
 servers.set(id, entry);
 try {
  if (def.type === 'remote' || def.url) await startRemote(id, entry, def);
  else await startLocal(id, entry, def);
  const listed = await entry.client.listTools();
  entry.tools = (listed?.tools || []).map(tool => ({
   name: String(tool.name || ''),
   description: snippet(tool.description).slice(0, 300),
   inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
  })).filter(tool => tool.name);
  entry.state = 'ready';
 } catch (error) {
  entry.state = 'failed';
  entry.error ||= snippet(error?.message) || 'could not start';
  entry.client = null;
 }
}

async function init() {
 stopAll();
 const config = loadConfig();
 const entries = Object.entries(config.servers || {});
 for (const [id, def] of entries) {
  if (def?.enabled === false) {
   servers.set(id, { id, state: 'disabled', error: '', tools: [], auto: Boolean(def?.autoApprove) });
   continue;
  }
  await startServer(id, def).catch(() => {});
 }
}

async function reload() {
 await init();
 return status();
}

function stopAll() {
 for (const entry of servers.values()) {
  try { entry.client?.close?.(); } catch {}
 }
 servers.clear();
}

function flattenTools() {
 const out = [];
 for (const [id, entry] of servers) {
  for (const tool of entry.tools || []) {
   out.push({
    name: `${sanitize(id)}_${sanitize(tool.name)}`,
    server: id,
    tool: tool.name,
    description: tool.description || '',
    auto: Boolean(entry.auto),
    inputSchema: tool.inputSchema,
   });
  }
 }
 return out;
}

async function call(name, args) {
 const tool = flattenTools().find(item => item.name === name);
 if (!tool) return { text: `Unknown MCP tool: ${name}`, isError: true };
 const entry = servers.get(tool.server);
 if (!entry?.client) return { text: `MCP server ${tool.server} is not running`, isError: true };
 try {
  const result = await withTimeout(
   entry.client.callTool({ name: tool.tool, arguments: args && typeof args === 'object' ? args : {} }, undefined, { timeout: CALL_TIMEOUT }),
   CALL_TIMEOUT + 2000,
   `no answer within ${CALL_TIMEOUT / 1000}s`,
  );
  const parts = [];
  for (const item of result?.content || []) {
   if (item?.type === 'text') parts.push(String(item.text ?? ''));
   else if (item?.type === 'image') parts.push(`[image: ${item.mimeType || 'image'}]`);
   else if (item?.type === 'audio') parts.push(`[audio: ${item.mimeType || 'audio'}]`);
   else if (item?.type === 'resource') parts.push(`[resource: ${item.resource?.uri || ''}]`);
   else if (item?.type) parts.push(`[${item.type}]`);
  }
  const text = parts.join('\n').trim() || '(no output)';
  return { text, isError: Boolean(result?.isError) };
 } catch (error) {
  return { text: snippet(error?.message) || 'the MCP call failed', isError: true };
 }
}

function status() {
 return {
  configPath: configPath(),
  imported: importing,
  servers: [...servers.values()].map(entry => ({
   id: entry.id,
   state: entry.state,
   error: entry.error,
   tools: (entry.tools || []).length,
  })),
 };
}

function openConfig() {
 try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); } catch {}
 if (!fs.existsSync(configPath())) fs.writeFileSync(configPath(), JSON.stringify({ servers: {} }, null, 2));
 return shell.openPath(configPath());
}

function register(fromApp) {
 ipcMain.handle('mcp:status', event => (fromApp(event) ? status() : { configPath: '', servers: [] }));
 ipcMain.handle('mcp:tools', event => (fromApp(event) ? flattenTools() : []));
 ipcMain.handle('mcp:call', (event, name, args) => (fromApp(event) ? call(name, args) : { text: 'Not allowed', isError: true }));
 ipcMain.handle('mcp:reload', async event => (fromApp(event) ? reload() : { configPath: '', servers: [] }));
 ipcMain.handle('mcp:open-config', event => (fromApp(event) ? openConfig() : null));
 ipcMain.handle('mcp:servers', event => (fromApp(event) ? serversInfo() : { configPath: '', servers: [] }));
 ipcMain.handle('mcp:save', (event, id, def) => (fromApp(event) ? saveServer(id, def) : { configPath: '', servers: [] }));
 ipcMain.handle('mcp:remove', (event, id) => (fromApp(event) ? removeServer(id) : { configPath: '', servers: [] }));
}

module.exports = { register, init, reload, stopAll, status, tools: flattenTools, call };

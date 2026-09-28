// prism discord — talks to Prism from Discord DMs, so the phone can reach this computer
// from any network, with no port forwarding and no VPN. The bot only ever answers the
// user id in %APPDATA%\Prism\discord.json (the same file the finish-notifications use);
// the token lives there too. Tools run without asking, so keep the bot private.
//
//   prism discord                  start listening for DMs
//   prism discord --no-tools       chat only, no tools on this computer
//   prism discord --once "hello"   run one turn in the terminal and print the reply
import { createEngineHost } from "./engine-host.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
 const at = args.indexOf(name);
 return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const rawProfile = String(flag("--profile", "")).toLowerCase();
const PROFILE = /^[a-z0-9-]{1,24}$/.test(rawProfile) ? rawProfile : "";
const ONCE = flag("--once", "");
const NO_TOOLS = args.includes("--no-tools");

const host = createEngineHost({ profile: PROFILE });
const { ROOT, USER_DATA, engines } = host;

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...parts) => console.log(`[${stamp()}]`, ...parts);

// --------------------------------------------------------------- config + state
const configFile = join(USER_DATA, "discord.json");
const stateFile = join(USER_DATA, "discord-chat.json");
const readJson = (file, fallback = {}) => {
 try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
};
const writeJson = (file, value) => {
 try { writeFileSync(file, JSON.stringify(value, null, 2)); } catch (error) { log("could not save", file, String(error.message)); }
};

const config = readJson(configFile);
const state = Object.assign(
 { messages: [], folder: process.env.USERPROFILE || process.env.HOME || ".", model: "opencode-go:deepseek-v4.1-flash", lastId: "0", effort: "" },
 readJson(stateFile),
);
// How the bridge runs is decided here, not by what an earlier run saved.
state.tools = NO_TOOLS ? false : config.tools !== false;
if (flag("--folder")) state.folder = String(flag("--folder"));
if (flag("--model")) state.model = String(flag("--model"));

const savedState = () => writeJson(stateFile, { messages: state.messages, folder: state.folder, model: state.model, lastId: state.lastId, effort: state.effort, thinking: state.thinking });

// The app keeps provider keys in its own storage; the bridge reads the bridge config,
// and falls back to OpenCode's auth file for the Go provider.
function keyOf(provider) {
 if (typeof config.key === "string" && config.key.trim()) return config.key.trim();
 if (provider === "opencode-go") {
  const home = process.env.USERPROFILE || process.env.HOME || ".";
  const auth = readJson(join(home, ".local", "share", "opencode", "auth.json"), null);
  return auth?.["opencode-go"]?.key || Object.values(auth || {}).find(entry => entry?.key)?.key || "";
 }
 return "";
}

// --------------------------------------------------------------- renderer modules on a window shim
const window = {};
globalThis.window = window;
window.openghost = {
 tools: {
  run: (id, name, toolArgs, cwd) => host.invoke("tool:run", id, name, toolArgs, cwd),
  cancel: id => host.invoke("tool:cancel", id),
  environment: () => host.invoke("tool:environment"),
 },
 mcp: { tools: () => host.invoke("mcp:tools"), call: (name, toolArgs) => host.invoke("mcp:call", name, toolArgs) },
 memory: {
  list: () => host.invoke("memory:list"),
  add: text => host.invoke("memory:add", text),
  remove: id => host.invoke("memory:remove", id),
 },
};
for (const file of ["agent-tools.js", "agent-prompt.js"]) {
 try { new Function("window", readFileSync(join(ROOT, "app", file), "utf8"))(window); } catch (error) { log("could not load", file, String(error.message)); }
}
const AgentTools = window.AgentTools;
const AgentPrompt = window.AgentPrompt;

// --------------------------------------------------------------- one model call
let currentRun = "";
function stream(messages, { tools, onDelta }) {
 return new Promise((resolve, reject) => {
  const id = `dc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let content = "";
  const sender = {
   send: (channel, data) => {
    if (channel !== "llm:event" || data?.id !== id) return;
    if (data.type === "content") { content += data.delta; onDelta?.(data.delta); }
    else if (data.type === "done") resolve({ ...data.result, content: data.result?.content ?? content });
    else if (data.type === "error") reject(Object.assign(new Error(data.message || "the model stopped"), { status: data.status }));
   },
   isDestroyed: () => false,
  };
  host.setSender(sender);
  currentRun = id;
  const [provider, ...rest] = String(state.model).split(":");
  host.emit("llm:start", id, {
   provider,
   key: keyOf(provider),
   model: rest.join(":") || state.model,
   effort: state.effort || "default",
   vision: true,
   thinking: state.thinking,
   messages,
   tools,
   maxTokens: 8000,
  });
 });
}

async function modelDef() {
 try {
  const [provider] = String(state.model).split(":");
  const reply = await host.invoke("llm:models", provider, keyOf(provider));
  return (reply?.models || []).find(item => item.id === state.model) || null;
 } catch { return null; }
}

// --------------------------------------------------------------- a turn with tools
async function systemPrompt() {
 const def = await modelDef();
 state.thinking = def?.thinking;
 if (!state.effort && def?.defaultEffort) state.effort = def.defaultEffort;
 const env = await AgentTools.environment().catch(() => null);
 await AgentTools.refreshMcp();
 const mcp = AgentTools.mcpSummary();
 let memory = "";
 try {
  const items = (await window.openghost.memory.list()) || [];
  if (items.length) memory = ["# Memory", ...items.map(item => `- ${item.text}`)].join("\n");
 } catch {}
 return `${AgentPrompt.build({ folder: state.folder, mode: "full", env, browser: "", mcp, memory, plan: "", instructions: "", skills: "", now: new Date() })}\n\n# Remote control\nYou are answering over Discord, from the user's phone. Keep replies short and plain; Discord markdown works.${state.tools ? " Tools run without asking." : " Tools are unavailable in this session: never attempt a tool call, answer in plain text."}`;
}

async function turn(prompt, onStatus = () => {}) {
 state.messages.push({ role: "user", content: prompt });
 const tools = state.tools ? AgentTools.schemas : undefined;
 const system = await systemPrompt();
 let lastStatus = "";
 const status = line => {
  if (line === lastStatus) return;
  lastStatus = line;
  onStatus(line);
 };
 for (let step = 0; step < 12; step++) {
  if (state.stopped) return "⏹ stopped";
  const result = await stream([{ role: "system", content: system }, ...state.messages], { tools, onDelta: () => status("✍️ writing…") });
  const calls = (result.toolCalls || []).filter(call => call?.function?.name);
  if (!calls.length) {
   state.messages.push({ role: "assistant", content: result.content || "" });
   savedState();
   return result.content?.trim() || "(the model sent an empty reply)";
  }
  state.messages.push({ role: "assistant", content: result.content || "", tool_calls: calls });
  const pictures = [];
  for (const call of calls) {
   if (state.stopped) return "⏹ stopped";
   let callArgs = {};
   try { callArgs = JSON.parse(call.function.arguments || "{}"); } catch {}
   status(`🔧 ${call.function.name}`);
   let output = "";
   try {
    const toolResult = await AgentTools.run(call.function.name, callArgs, { id: `dc-tool-${call.id}`, cwd: state.folder });
    // Tools can answer with text, or with text plus pictures (a screenshot, an image file).
    output = typeof toolResult === "string" ? toolResult : String(toolResult?.text ?? JSON.stringify(toolResult ?? ""));
    if (toolResult?.images?.length) pictures.push(...toolResult.images);
   } catch (error) {
    output = `Error: ${error.message}`;
   }
   state.messages.push({ role: "tool", tool_call_id: call.id, content: output });
  }
  if (pictures.length) {
   const content = [{ type: "text", text: "The pictures from the tools you just ran follow." }];
   for (const picture of pictures) content.push({ type: "text", text: picture.label }, { type: "image_url", image_url: { url: picture.url } });
   state.messages.push({ role: "user", content });
  }
 }
 return "(stopped after 12 tool steps)";
}

// --------------------------------------------------------------- Discord
const DISCORD = "https://discord.com/api/v10";
const api = (path, options = {}) => fetch(DISCORD + path, {
 ...options,
 headers: { authorization: `Bot ${config.token || ""}`, "content-type": "application/json", ...(options.headers || {}) },
});
const chunk = text => {
 const out = [];
 let rest = String(text);
 while (rest.length > 1900) {
  let at = rest.lastIndexOf("\n", 1900);
  if (at < 400) at = 1900;
  out.push(rest.slice(0, at));
  rest = rest.slice(at).replace(/^\n+/, "");
 }
 if (rest) out.push(rest);
 return out.length ? out : ["(empty)"];
};

async function dmChannel() {
 const res = await api("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: String(config.userId) }) });
 if (!res.ok) throw new Error(`could not open a DM (${res.status}) — check the bot token and user id`);
 return (await res.json()).id;
}

async function replyTo(channel, messageId, text) {
 const parts = chunk(text);
 await api(`/channels/${channel}/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ content: parts[0] }) });
 for (const part of parts.slice(1)) await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: part }) });
}

const HELP = [
 "**Prism bridge** — I run on your PC and answer here.",
 "",
 "`/new` — start a fresh conversation",
 "`/stop` — stop the reply being written",
 "`/folder <path>` — the folder tools work in",
 "`/model <provider:id>` — switch model (e.g. `opencode-go:deepseek-v4.1-flash`)",
 "`/status` — what I am set to",
 "`/help` — this",
].join("\n");

async function handle(channel, message) {
 const text = String(message.content || "").trim();
 if (!text) return;
 log("dm:", text.slice(0, 80));
 if (text === "/help") return void await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: HELP }) });
 if (text === "/new") {
  state.messages = [];
  savedState();
  return void await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: "✨ fresh conversation" }) });
 }
 if (text === "/stop") {
  state.stopped = true;
  if (currentRun) host.emit("llm:abort", currentRun);
  return void await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: "⏹ stopping…" }) });
 }
 if (text === "/status") {
  const lines = [`model: \`${state.model}\``, `folder: \`${state.folder}\``, `tools: ${state.tools ? "on" : "off"}`, `messages in context: ${state.messages.length}`];
  return void await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: lines.join("\n") }) });
 }
 if (text.startsWith("/folder ")) {
  const folder = text.slice(8).trim();
  if (!existsSync(folder)) return void await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: `no such folder: \`${folder}\`` }) });
  state.folder = folder;
  savedState();
  return void await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: `📁 tools now work in \`${folder}\`` }) });
 }
 if (text.startsWith("/model ")) {
  state.model = text.slice(7).trim();
  state.effort = "";
  savedState();
  return void await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: `🧠 model: \`${state.model}\`` }) });
 }

 state.stopped = false;
 const placeholder = await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: "⏳ working…" }) });
 const placeholderId = (await placeholder.json().catch(() => ({})))?.id;
 let shown = "", shownAt = 0;
 const status = line => {
  const now = Date.now();
  if (line === shown || now - shownAt < 1200 || !placeholderId) return;
  shown = line;
  shownAt = now;
  api(`/channels/${channel}/messages/${placeholderId}`, { method: "PATCH", body: JSON.stringify({ content: line }) }).catch(() => {});
 };
 try {
  const answer = await turn(text, status);
  if (placeholderId) await replyTo(channel, placeholderId, answer);
  else await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: chunk(answer)[0] }) });
  log("replied:", answer.replace(/\s+/g, " ").slice(0, 100));
 } catch (error) {
  const note = `⚠️ ${error.message}`;
  if (placeholderId) await replyTo(channel, placeholderId, note);
  else await api(`/channels/${channel}/messages`, { method: "POST", body: JSON.stringify({ content: note }) });
  log("failed:", error.message);
 }
}

// --------------------------------------------------------------- run
if (ONCE) {
 (async () => {
  log(`one turn — model ${state.model}, folder ${state.folder}, tools ${state.tools ? "on" : "off"}`);
  try {
   const answer = await turn(String(ONCE), line => log(line));
   console.log("\n" + answer + "\n");
   process.exit(0);
  } catch (error) {
   console.error("\nfailed:", error.message, "\n");
   process.exit(1);
  }
 })();
} else if (!config.token || !config.userId) {
 console.error(`\n  The Discord bot is not set up yet. Add a bot token and your user id in Prism:\n  Settings -> Interface -> Discord notifications (the same bot is used here),\n  or edit ${configFile} by hand:\n\n  { "token": "…", "userId": "…", "enabled": true }\n\n  Create the bot at https://discord.com/developers (New Application -> Bot), enable\n  "Message Content Intent" on the Bot page, invite it to a private server of yours\n  (OAuth2 -> URL Generator -> scope "bot") so Discord lets it DM you, then DM it.\n`);
 process.exit(1);
} else {
 (async () => {
  const channel = await dmChannel();
  // Start from now: old DMs are not replayed.
  const recent = await api(`/channels/${channel}/messages?limit=1`).then(res => (res.ok ? res.json() : [])).catch(() => []);
  if (recent[0]?.id && state.lastId === "0") state.lastId = recent[0].id;
  console.log(`\n  Prism on Discord  ->  model ${state.model}`);
  console.log(`  folder            ->  ${state.folder}`);
  console.log(`  tools             ->  ${state.tools ? "on (full access to this computer)" : "off"}`);
  console.log("  DM the bot from any network; this terminal logs what it does. Ctrl+C stops it.\n");
  let running = false;
  setInterval(async () => {
   if (running) return;
   running = true;
   try {
    const res = await api(`/channels/${channel}/messages?limit=10`);
    if (res.ok) {
     const list = await res.json();
     const fresh = list.filter(item => item.author?.id === String(config.userId) && item.id > state.lastId).reverse();
     for (const item of fresh) {
      state.lastId = item.id;
      await handle(channel, item);
     }
    } else if (res.status === 401) {
     log("the bot token was rejected (401) — check it in Settings -> Discord");
    }
   } catch (error) {
    log("poll failed:", error.message);
   } finally {
    running = false;
   }
  }, 3000);
 })();
}

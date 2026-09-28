// Imports OpenCode sessions into Prism.
//
//   bun run tools/import-opencode.mjs            (imports everything it finds)
//   bun run tools/import-opencode.mjs --dry      (lists what would be imported)
//   bun run tools/import-opencode.mjs --only ses_xxx
//
// Reads opencode.db read-only, converts sessions (both schema eras) into Prism chats and
// writes them into the Prism store. Close Prism before running: the running app holds the
// index in memory and would overwrite it. A backup of the store is made first.
import { Database } from "bun:sqlite"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { homedir } from "node:os"

const args = process.argv.slice(2)
const dry = args.includes("--dry")
const onlyArg = args.indexOf("--only")
const only = onlyArg >= 0 ? cleanId(args[onlyArg + 1] || "") : null

// Store keys allow lowercase letters, digits, dash and underscore.
function cleanId(value) {
 return String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

const DB = pick("--db", join(homedir(), ".local", "share", "opencode", "opencode.db"))
const STORE = pick("--store", join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Prism", "store"))

function pick(flag, fallback) {
  const at = args.indexOf(flag)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}

const TOOL_NAME = {
  bash: "run_powershell",
  shell: "run_powershell",
  read: "read_file",
  write: "write_file",
  edit: "edit_file",
  patch: "patch",
  list: "list_files",
  ls: "list_files",
  glob: "glob",
  grep: "grep",
  webfetch: "fetch_url",
  websearch: "web_search",
  task: "task",
  todowrite: "todowrite",
};
const ARG_NAME = { filePath: "path", file_path: "path", oldString: "old_string", newString: "new_string", replaceAll: "replace_all" };
const OUTPUT_MAX = 2000;

const mapArgs = (input) => {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) out[ARG_NAME[key] || key] = value;
  return out;
};
const cut = (text, max = OUTPUT_MAX) => {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}\n… (${value.length - max} more characters)` : value;
};

const toolState = (state) => {
  if (!state) return "";
  const parts = Array.isArray(state.content) ? state.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : "";
  return cut(parts || state.output || state.metadata?.output || (state.error ? `Error: ${state.error}` : ""));
};

const stepPair = (name, callID, input, output) => {
  const mapped = TOOL_NAME[name] || name || "tool";
  return [
    { role: "assistant", content: "", tool_calls: [{ id: String(callID || `${mapped}-${Math.random().toString(36).slice(2, 8)}`), type: "function", function: { name: mapped, arguments: JSON.stringify(mapArgs(input)) } }] },
    { role: "tool", tool_call_id: String(callID || ""), content: cut(output) },
  ];
};

// --------------------------------------------------------------- conversion

function fromV2(db, session) {
  const rows = db.query(`SELECT type, data FROM session_message WHERE session_id = ? ORDER BY seq`).all(session.id);
  const messages = [];
  let turn = 0;
  let model = null;
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (row.type === "user") {
      const text = String(data.text ?? data.metadata?.displayText ?? "").trim();
      if (!text) continue;
      const ref = data.metadata?.model;
      if (!model && ref?.providerID && ref?.modelID) model = { providerID: ref.providerID, modelID: ref.modelID };
      turn++;
      messages.push({ role: "user", text, content: text });
    } else if (row.type === "assistant") {
      const text = [];
      const thinking = [];
      const steps = [];
      for (const item of data.content || []) {
        if (item?.type === "text" && item.text) text.push(item.text);
        else if (item?.type === "reasoning" && item.text) thinking.push(item.text);
        else if (item?.type === "tool") {
          const id = item.id || item.callID;
          const pair = stepPair(item.name, id, item.state?.input, toolState(item.state));
          pair[1].tool_call_id = String(id || pair[0].tool_calls[0].id);
          steps.push(...pair);
        }
      }
      const content = text.join("").trim();
      const thought = thinking.join("\n\n").trim();
      if (!content && !thought && !steps.length) continue;
      if (!model && data.model?.providerID && data.model?.id) model = { providerID: data.model.providerID, modelID: data.model.id };
      messages.push({
        role: "assistant",
        content: content || "\u200b",
        steps,
        ...(thought ? { thinking: thought } : {}),
        turn: `t${turn}`,
      });
    }
  }
  return { messages, model };
}

function fromV1(db, session) {
  const rows = db.query(`SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id`).all(session.id);
  const messages = [];
  let turn = 0;
  let model = null;
  let tokens = 0;
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    const parts = db.query(`SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id`).all(row.id).map((p) => {
      try {
        return JSON.parse(p.data);
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (data.role === "user") {
      const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n").trim();
      if (!text) continue;
      turn++;
      messages.push({ role: "user", text, content: text });
    } else if (data.role === "assistant") {
      const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
      const thinking = parts.filter((p) => p.type === "reasoning").map((p) => p.text).join("\n\n");
      const steps = [];
      for (const part of parts) {
        if (part.type !== "tool") continue;
        const pair = stepPair(part.tool, part.callID, part.state?.input, toolState(part.state));
        pair[1].tool_call_id = String(part.callID || pair[0].tool_calls[0].id);
        steps.push(...pair);
      }
      const content = text.trim();
      if (!content && !thinking.trim() && !steps.length) continue;
      tokens += Number(data.tokens?.total || 0) || 0;
      if (!model && data.providerID && data.modelID) model = { providerID: data.providerID, modelID: data.modelID };
      messages.push({ role: "assistant", content: content || "\u200b", steps, ...(thinking.trim() ? { thinking: thinking.trim() } : {}), turn: `t${turn}` });
    }
  }
  return { messages, model };
}

// --------------------------------------------------------------- store

const indexPath = join(STORE, "index.json")
const storeDb = dry || !existsSync(indexPath) ? { version: 1, folders: [], chats: [] } : JSON.parse(readFileSync(indexPath, "utf8"))
const folders = Array.isArray(storeDb.folders) ? storeDb.folders : []
const chats = Array.isArray(storeDb.chats) ? storeDb.chats : []
const samePath = (a, b) => String(a).replace(/[\\/]+$/, "").toLowerCase() === String(b).replace(/[\\/]+$/, "").toLowerCase()

function folderEntry(dir) {
  let folder = folders.find((f) => samePath(f.path, dir))
  if (!folder) {
    folder = { path: dir, name: basename(dir.replace(/[\\/]+$/, "")) || dir, collapsed: false, added: Date.now() };
    folders.push(folder)
  }
  return folder
}

const db = new Database(DB, { readonly: true, strict: true })
const v2 = db.query(`SELECT id, title, directory, time_created, time_updated FROM session_v2 WHERE parent_id IS NULL ORDER BY time_updated DESC`).all()
const v1 = db.query(`SELECT id, title, directory, time_created, time_updated FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC`).all()

const planned = []
const seen = new Set()
for (const [era, rows] of [["v2", v2], ["v1", v1]]) {
  for (const session of rows) {
    const id = cleanId(session.id)
    if (seen.has(id)) continue
    if (only && id !== only) continue
    const count = era === "v2"
      ? db.query(`SELECT COUNT(*) AS n FROM session_message WHERE session_id = ?`).get(session.id).n
      : db.query(`SELECT COUNT(*) AS n FROM message WHERE session_id = ?`).get(session.id).n
    if (!count) continue
    const exists = chats.some((c) => c.id === id)
    planned.push({ era, session, id, count, exists })
    seen.add(id)
  }
}
db.close()

console.log(`store: ${STORE}`)
console.log(`sessions found: ${planned.length} (${planned.filter((p) => p.exists).length} already imported)`)
for (const p of planned.slice(0, 60)) {
  console.log(`  [${p.era}] ${p.id} | ${String(p.count).padStart(5)} msgs | ${new Date(p.session.time_updated).toISOString().slice(0, 16)} | ${String(p.session.title || "").slice(0, 48)}`)
}
if (planned.length > 60) console.log(`  … and ${planned.length - 60} more`)
if (dry) process.exit(0)

// backup
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
cpSync(STORE, `${STORE}-backup-${stamp}`, { recursive: true })
console.log(`backup: ${STORE}-backup-${stamp}`)

mkdirSync(join(STORE, "chats"), { recursive: true })

let imported = 0
for (const plan of planned) {
  const database = new Database(DB, { readonly: true, strict: true })
  const { messages, model } = plan.era === "v2" ? fromV2(database, plan.session) : fromV1(database, plan.session)
  database.close()
  if (!messages.some((m) => m.role === "assistant")) continue
  const chars = JSON.stringify(messages).length
  const tokens = Math.ceil(chars / 4)
  writeFileSync(join(STORE, "chats", `${plan.id}.json`), JSON.stringify({ version: 1, messages, tokens }))
  const record = {
    id: plan.id,
    title: String(plan.session.title || "Imported chat").slice(0, 120),
    folder: plan.session.directory,
    created: plan.session.time_created || plan.session.time_updated,
    updated: plan.session.time_updated,
    pinned: false,
    named: true,
    ...(model?.providerID && model?.modelID ? { model: `${model.providerID}:${model.modelID}` } : {}),
  }
  folderEntry(plan.session.directory)
  const at = chats.findIndex((c) => c.id === plan.id)
  if (at >= 0) chats[at] = record
  else chats.push(record)
  imported++
  console.log(`  imported [${plan.era}] ${plan.id} | ${messages.length} messages | ${(chars / 1024).toFixed(0)} KB`)
}

writeFileSync(indexPath, JSON.stringify({ version: 1, folders, chats }))
console.log(`done: ${imported} chats imported, ${folders.length} folders in the index`)

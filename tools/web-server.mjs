// prism web — serves Prism to a browser on this machine (or the LAN with --host).
// The renderer talks to the same engines the desktop app uses: the modules in desktop/
// are loaded behind a small require-hook that stands in for the Electron pieces
// (app paths, ipcMain, shell, notifications), so tools, models, MCP servers and memory
// all keep working. Close the terminal to stop the server.
//
//   node tools/web-server.mjs [--port 8787] [--host 127.0.0.1] [--profile work] [--no-open]
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { createEngineHost } from "./engine-host.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
 const at = args.indexOf(name);
 return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const PORT = Number(flag("--port", "8787"));
const HOST = flag("--host", "127.0.0.1");
const rawProfile = String(flag("--profile", "")).toLowerCase();
const PROFILE = /^[a-z0-9-]{1,24}$/.test(rawProfile) ? rawProfile : "";
const OPEN = !args.includes("--no-open");

// --------------------------------------------------------------- the engine host
const host = createEngineHost({ profile: PROFILE });
const { USER_DATA } = host;

// --------------------------------------------------------------- http + websocket
const MIME = {
 ".html": "text/html; charset=utf-8",
 ".js": "text/javascript; charset=utf-8",
 ".css": "text/css; charset=utf-8",
 ".svg": "image/svg+xml",
 ".png": "image/png",
 ".jpg": "image/jpeg",
 ".ico": "image/x-icon",
 ".woff2": "font/woff2",
 ".json": "application/json",
 ".map": "application/json",
};

const page = () => readFileSync(join(ROOT, "app", "index.html"), "utf8")
 .replace('  <script src="desktop.js"></script>', '  <script src="/web-bridge.js"></script>\n  <script src="desktop.js"></script>');

const stamp = () => new Date().toISOString().slice(11, 19);
let connections = 0;

const server = createServer((req, res) => {
 const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
 const send = (status, body, type) => {
  // The renderer gets edited by hand while it is being worked on, and a browser holding an old
  // copy of chat.js or styles.css looks exactly like a change that never happened. Never cache.
  res.writeHead(status, {
   "content-type": type || MIME[extname(url.pathname)] || "application/octet-stream",
   "cache-control": "no-store, no-cache, must-revalidate",
   "pragma": "no-cache",
   "expires": "0",
  });
  res.end(body);
 };
 if (url.pathname === "/ws") { res.writeHead(426); res.end("websocket only"); return; }
 if (url.pathname === "/web-bridge.js") return send(200, readFileSync(join(ROOT, "tools", "web-bridge.js")), "text/javascript; charset=utf-8");
 if (url.pathname === "/" || url.pathname === "/index.html") return send(200, page(), "text/html; charset=utf-8");
 const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
 const direct = join(ROOT, safe);
 const renderer = join(ROOT, "app", safe);
 if (!direct.startsWith(ROOT)) return send(403, "forbidden", "text/plain");
 // Renderer files live in app/; a few shared assets (icons, cursor) stay in desktop/.
 for (const file of [direct, renderer]) {
  if (existsSync(file) && statSync(file).isFile() && !file.endsWith("index.html")) return send(200, readFileSync(file));
 }
 return send(200, page(), "text/html; charset=utf-8");
});

const wss = new WebSocketServer({ server, path: "/ws" });
// A busy port is a normal thing to hit: say so plainly instead of a stack trace.
const busy = error => {
 if (error?.code !== "EADDRINUSE") throw error;
 console.error(`\n  Port ${PORT} is already in use — another Prism web is probably running.\n  Stop it, or start this one elsewhere:  prism web --port ${PORT + 1}\n`);
 process.exit(1);
};
server.on("error", busy);
wss.on("error", busy);
wss.on("connection", ws => {
 const data = { id: ++connections };
 data.send = (channel, ...eventArgs) => { try { ws.send(JSON.stringify({ t: "event", channel, args: eventArgs })); } catch {} };
 console.log(`[${stamp()}] connection ${data.id} opened`);
 ws.on("close", () => console.log(`[${stamp()}] connection ${data.id} closed`));
 ws.on("message", async raw => {
  let msg;
  try { msg = JSON.parse(String(raw)); } catch { return; }
  host.setSender({ send: data.send, isDestroyed: () => false });
  const reply = (t, id, payload) => ws.send(JSON.stringify({ t, id, ...payload }));
  try {
   if (msg.t === "invoke") {
    const value = await host.invoke(msg.channel, ...(msg.args || []));
    reply("result", msg.id, { value });
    if (String(msg.channel).startsWith("tool:")) console.log(`[${stamp()}] ${msg.channel} ok`);
   } else if (msg.t === "send") {
    host.emit(msg.channel, ...(msg.args || []));
    if (msg.channel === "llm:start") console.log(`[${stamp()}] llm:start ${msg.args?.[1]?.provider}/${msg.args?.[1]?.model}`);
   }
  } catch (error) {
   reply("error", msg.id, { error: String(error?.message || error) });
   console.log(`[${stamp()}] ${msg.channel} error: ${String(error?.message || error).slice(0, 160)}`);
  }
 });
});

server.listen(PORT, HOST, () => {
 const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
 console.log(`\n  Prism web  ->  http://${shown}:${server.address().port}`);
 console.log(`  store      ->  ${USER_DATA}`);
 if (HOST === "0.0.0.0") console.log("  note: reachable from your network; anyone on it can run tools on this computer.");
 console.log("  the terminal stays like this: requests, models and tools show up below.\n");
 if (OPEN) {
  const url = `http://localhost:${server.address().port}`;
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref(); } catch {}
 }
});

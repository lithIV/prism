#!/usr/bin/env node
// prism — the Prism command line.
//
//   prism                 opens the desktop app
//   prism web             serves Prism to the browser and logs what it does in this terminal
//   prism web --host 0.0.0.0 --port 8787     for a server or another device
//   prism web --profile work                a separate workspace
//   prism import [--dry]  brings OpenCode chats over
//
// After `npm link` inside the app folder the `prism` command exists in any terminal.
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const command = args[0] || ""
const bash = process.platform === "win32"

const run = (cmd, cmdArgs, options = {}) => {
 const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: bash, ...options })
 return result.status ?? 1
}

const has = cmd => spawnSync(cmd, ["--version"], { stdio: "ignore", shell: bash }).status === 0

if (command === "web") {
 if (!has("node")) {
  console.error("prism web needs Node.js on PATH (the engines run in Node). Install it from https://nodejs.org and try again.")
  process.exit(1)
 }
 const passthrough = args.slice(1)
 process.exit(run("node", [join(root, "tools", "web-server.mjs"), ...passthrough]))
}

if (command === "discord") {
 if (!has("node")) {
  console.error("prism discord needs Node.js on PATH (the engines run in Node). Install it from https://nodejs.org and try again.")
  process.exit(1)
 }
 process.exit(run("node", [join(root, "tools", "discord-bridge.mjs"), ...args.slice(1)]))
}

if (command === "import") {
 if (!has("bun") && !existsSync(join(root, "node_modules"))) {
  console.error("prism import needs Bun. Install it from https://bun.sh and try again.")
  process.exit(1)
 }
 process.exit(run("bun", ["run", join(root, "tools", "import-opencode.mjs"), ...args.slice(1)]))
}

if (command === "--help" || command === "help") {
 console.log("prism            open the desktop app\nprism web        serve Prism to the browser (terminal logs activity)\nprism discord    talk to Prism from Discord DMs (works from any network)\nprism import     bring OpenCode chats into Prism")
 process.exit(0)
}

// default: the desktop app — the installed one when there is one, else Electron from this folder
const installed = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Prism", "Prism.exe") : ""
if (installed && existsSync(installed)) {
 const child = spawn(installed, args, { detached: true, stdio: "ignore" })
 child.unref()
 process.exit(0)
}
process.exit(run("npx", ["electron", ".", ...args], { cwd: root }))

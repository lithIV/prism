'use strict';

// Instruction files per folder, shared by the desktop app and the web engine host (prism web).
// A folder may keep its instructions in the usual places (AGENTS.md, CLAUDE.md, any .md) and
// also inside .prism/instructions. The .prism folder is where the agent's own files live:
// instructions, skills and MCP notes, all in one place inside the workspace.
const { ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PRISM_DIR = '.prism';
const INSTRUCTION_NAMES = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', 'INSTRUCTIONS.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md', '.claude/CLAUDE.md', '.opencode/AGENTS.md'];
// Documents that only describe a project: useful to read, noise in an instruction picker.
const NOISE = /^(readme|licen[cs]e|changelog|changes|contributing|authors|notice|todo)(\.[a-z]+)?$/i;

const list = directory => {
 const found = [];
 const push = name => {
  const normalized = name.replace(/\\/g, '/');
  if (!found.includes(normalized) && found.length < 60) found.push(normalized);
 };
 for (const name of INSTRUCTION_NAMES) {
  try { if (fs.statSync(path.join(directory, name)).isFile()) push(name); } catch {}
 }
 try {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
   if (entry.isFile() && /\.md$/i.test(entry.name) && !NOISE.test(entry.name)) push(entry.name);
  }
 } catch {}
 try {
  const dir = path.join(directory, PRISM_DIR, 'instructions');
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   if (entry.isFile() && /\.md$/i.test(entry.name)) push(`${PRISM_DIR}/instructions/${entry.name}`);
  }
 } catch {}
 return found;
};

const read = (directory, file) => {
 if (typeof directory !== 'string' || typeof file !== 'string') return null;
 const base = path.resolve(directory), target = path.resolve(base, file);
 if (!target.startsWith(base)) return null;
 try { return fs.readFileSync(target, 'utf8').slice(0, 20000); } catch { return null; }
};

// Makes sure .prism exists with its folders and opens it in the file manager.
const openFolder = async directory => {
 const base = path.join(directory, PRISM_DIR);
 try {
  for (const child of ['', 'instructions', 'skills', 'mcp']) fs.mkdirSync(path.join(base, child), { recursive: true });
 } catch { return false; }
 try { return !(await shell.openPath(base)); } catch { return false; }
};

const readSkill = file => {
 try {
  const text = fs.readFileSync(file, 'utf8').slice(0, 4000);
  const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() || path.basename(path.dirname(file));
  const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() || '';
  return { name, description: description.slice(0, 200), path: file };
 } catch {
  return null;
 }
};

const listSkills = directory => {
 const roots = [path.join(os.homedir(), '.claude', 'skills')];
 if (typeof directory === 'string') {
  roots.push(path.join(directory, '.claude', 'skills'));
  roots.push(path.join(directory, PRISM_DIR, 'skills'));
 }
 const out = [];
 for (const root of roots) {
  try {
   for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = readSkill(path.join(root, entry.name, 'SKILL.md'));
    if (skill) out.push(skill);
   }
  } catch {}
 }
 return out.slice(0, 60);
};

function register(fromApp) {
 ipcMain.handle('instructions:list', (event, directory) => (fromApp(event) && typeof directory === 'string' ? list(directory) : []));
 ipcMain.handle('instructions:read', (event, directory, file) => (fromApp(event) ? read(directory, file) : null));
 ipcMain.handle('instructions:open', (event, directory) => (fromApp(event) && typeof directory === 'string' ? openFolder(directory) : false));
 ipcMain.handle('skills:list', (event, directory) => (fromApp(event) ? listSkills(directory) : []));
}

module.exports = { register, list, read, openFolder, listSkills };

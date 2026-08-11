// Rewrite absolute paths in a QuickLauncher config.json as portable relative
// paths, based on the folder that holds the exe.
//
// Only paths on the same drive as the base dir can be relativized; anything
// else (other drives, URLs, bare PATH commands) is left untouched.
//
// Usage:
//   node scripts/relativize-config.mjs <config.json> [--base <dir>] [--write]
//
// Without --write it is a dry run and only prints the planned changes.
// The base dir defaults to the folder containing the config file.

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PATH_FIELDS = ["target", "startIn", "iconPath"];
const URL_RE = /^(?:https?|file):\/\//i;

function parseArgs(argv) {
  const args = { file: "", base: "", write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") args.write = true;
    else if (a === "--base") args.base = argv[++i];
    else if (!args.file) args.file = a;
  }
  return args;
}

const isAbsolute = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");

function cleanPath(p) {
  const win = p.replace(/\//g, "\\");
  const prefix = win.match(/^(?:[a-zA-Z]:|\\\\[^\\]+\\[^\\]+)/)?.[0] ?? "";
  const out = [];
  for (const seg of win.slice(prefix.length).split("\\")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `${prefix}\\${out.join("\\")}`;
}

function toRelative(p, base) {
  const t = p.trim();
  if (!isAbsolute(t) || URL_RE.test(t)) return t;
  const from = cleanPath(base).split("\\");
  const to = cleanPath(t).split("\\");
  if (from[0].toLowerCase() !== to[0].toLowerCase()) return t;

  let i = 0;
  while (
    i < from.length &&
    i < to.length &&
    from[i].toLowerCase() === to[i].toLowerCase()
  ) {
    i++;
  }
  const segs = [...Array(from.length - i).fill(".."), ...to.slice(i)];
  if (segs.length === 0) return ".";
  return segs[0] === ".." ? segs.join("\\") : `.\\${segs.join("\\")}`;
}

function toAbsolute(p, base) {
  const t = p.trim();
  if (!t || URL_RE.test(t) || isAbsolute(t)) return t;
  const isPath = t.includes("\\") || t.includes("/") || t === "." || t === "..";
  if (!isPath) return t;
  return cleanPath(`${base}\\${t}`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error("usage: node scripts/relativize-config.mjs <config.json> [--base <dir>] [--write]");
  process.exit(1);
}

const configPath = resolve(args.file);
const baseDir = cleanPath(args.base ? resolve(args.base) : dirname(configPath));

const raw = readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
const config = JSON.parse(raw);

const changes = [];
const skipped = new Map();

for (const item of collectItems(config)) {
  for (const field of PATH_FIELDS) {
    const value = item[field];
    if (!value || typeof value !== "string") continue;
    if (!isAbsolute(value) || URL_RE.test(value)) continue;

    const rel = toRelative(value, baseDir);
    if (rel === value) {
      const drive = value.slice(0, 2).toUpperCase();
      skipped.set(drive, (skipped.get(drive) ?? 0) + 1);
      continue;
    }
    // Safety: the relative form must resolve back to the original path
    const back = toAbsolute(rel, baseDir);
    if (back.replace(/\\$/, "") !== cleanPath(value).replace(/\\$/, "")) {
      console.error(`[SKIP] round-trip mismatch: ${value} -> ${rel} -> ${back}`);
      continue;
    }
    changes.push({ name: item.name || "(unnamed)", field, from: value, to: rel });
    item[field] = rel;
  }
}

function collectItems(cfg) {
  const items = [...(cfg.topBar ?? [])];
  for (const tab of cfg.tabs ?? []) items.push(...(tab.items ?? []));
  return items;
}

console.log(`config : ${configPath}`);
console.log(`base   : ${baseDir}`);
console.log(`mode   : ${args.write ? "WRITE" : "dry run (pass --write to apply)"}\n`);

if (changes.length === 0) {
  console.log("nothing to relativize.");
} else {
  const width = Math.max(...changes.map((c) => c.from.length));
  for (const c of changes) {
    console.log(`  [${c.field}] ${c.from.padEnd(width)}  ->  ${c.to}`);
  }
  console.log(`\nrelativized: ${changes.length}`);
}

if (skipped.size > 0) {
  const detail = [...skipped.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `${d}${n > 0 ? ` x${n}` : ""}`)
    .join(", ");
  console.log(`left as absolute (other drives): ${detail}`);
}

if (args.write && changes.length > 0) {
  const backup = `${configPath}.${Date.now()}.bak`;
  copyFileSync(configPath, backup);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`\nbackup : ${backup}`);
  console.log(`written: ${configPath}`);
}

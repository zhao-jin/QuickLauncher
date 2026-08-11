// Rewrite absolute paths in a QuickLauncher config.json as ${NAME} references,
// so the config becomes portable across machines (works across drives, unlike
// relative paths).
//
// Usage:
//   # auto-detect useful roots and preview
//   node scripts/varize-config.mjs <config.json>
//
//   # define roots explicitly
//   node scripts/varize-config.mjs <config.json> --root RED=I:\RED --root Self=E:\self
//
//   # apply (backs up first); --write implies keeping detected roots
//   node scripts/varize-config.mjs <config.json> --write
//
// Roots already present in the config are always honoured. Detected roots are
// added to config.roots so the result is self-contained.

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PATH_FIELDS = ["target", "startIn", "iconPath"];
const URL_RE = /^(?:https?|file):\/\//i;
const MIN_USES = 3;
const MIN_SEGMENTS = 2;

const isAbs = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");

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

function parseArgs(argv) {
  const args = { file: "", write: false, roots: {}, minUses: MIN_USES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") args.write = true;
    else if (a === "--root") {
      const spec = argv[++i] ?? "";
      const eq = spec.indexOf("=");
      if (eq > 0) args.roots[spec.slice(0, eq).trim()] = spec.slice(eq + 1).trim();
    } else if (a === "--min-uses") args.minUses = Number(argv[++i]) || MIN_USES;
    else if (!args.file) args.file = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error(
    "usage: node scripts/varize-config.mjs <config.json> [--root NAME=DIR]... [--min-uses N] [--write]"
  );
  process.exit(1);
}

const configPath = resolve(args.file);
const config = JSON.parse(
  readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")
);

const items = [
  ...(config.topBar ?? []),
  ...(config.tabs ?? []).flatMap((t) => t.items ?? []),
];

function collectAbsolutePaths() {
  const found = [];
  for (const item of items) {
    for (const field of PATH_FIELDS) {
      const v = item[field];
      if (v && typeof v === "string" && isAbs(v) && !URL_RE.test(v)) found.push(v);
    }
  }
  return found;
}

/**
 * Propose roots from repeated ancestor directories. System dirs under
 * C:\Windows are skipped: they already exist everywhere.
 */
function detectRoots(paths, minUses) {
  const counts = new Map();
  for (const p of paths) {
    const segs = cleanPath(p).split("\\");
    for (let depth = MIN_SEGMENTS; depth < segs.length; depth++) {
      const prefix = segs.slice(0, depth).join("\\");
      if (prefix.length < 4) continue;
      if (/^c:\\windows/i.test(prefix)) continue;
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  // Prefer the shallowest root: fewer variables, and `${Self}\bats\x` reads
  // better than needing both ${Self} and ${Bats}. Ties broken by shorter path.
  const ranked = [...counts.entries()]
    .filter(([, n]) => n >= minUses)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);

  // Drop candidates nested inside an already-kept root, and candidates that
  // merely wrap one (a parent adding no extra coverage).
  const kept = [];
  for (const [prefix, n] of ranked) {
    const lower = prefix.toLowerCase();
    const redundant = kept.some(([k, kn]) => {
      const kl = k.toLowerCase();
      return (
        lower.startsWith(`${kl}\\`) || (kl.startsWith(`${lower}\\`) && kn === n)
      );
    });
    if (!redundant) kept.push([prefix, n]);
  }
  return kept;
}

function nameFor(dir, taken) {
  const leaf = dir.split("\\").filter(Boolean).pop() ?? "ROOT";
  let base = leaf.replace(/[^A-Za-z0-9_-]/g, "");
  if (!base) base = "ROOT";
  if (!/^[A-Za-z_]/.test(base)) base = `R${base}`;
  // Capitalise for readability: self -> Self, auto -> Auto (RED stays RED)
  base = base[0].toUpperCase() + base.slice(1);
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base}${n++}`;
  taken.add(name.toLowerCase());
  return name;
}

// Existing roots win; detected ones fill the gaps.
const roots = { ...(config.roots ?? {}), ...args.roots };
const taken = new Set(Object.keys(roots).map((k) => k.toLowerCase()));
const detected = [];

if (Object.keys(args.roots).length === 0) {
  const known = Object.values(roots).map((v) => cleanPath(v).toLowerCase());
  for (const [dir, uses] of detectRoots(collectAbsolutePaths(), args.minUses)) {
    const lower = cleanPath(dir).toLowerCase();
    if (known.some((k) => lower === k || lower.startsWith(`${k}\\`))) continue;
    const name = nameFor(dir, taken);
    roots[name] = dir;
    detected.push({ name, dir, uses });
  }
}

/** Longest matching root wins, so nested roots behave predictably. */
function toVarPath(p) {
  const target = cleanPath(p);
  const lower = target.toLowerCase();
  let best = null;
  for (const [name, value] of Object.entries(roots)) {
    if (!value || !isAbs(value)) continue;
    const root = cleanPath(value).replace(/\\+$/, "");
    const rootLower = root.toLowerCase();
    if (lower !== rootLower && !lower.startsWith(`${rootLower}\\`)) continue;
    if (!best || root.length > best.len) best = { name, len: root.length };
  }
  if (!best) return p;
  const rest = target.slice(best.len).replace(/^\\+/, "");
  return rest ? `\${${best.name}}\\${rest}` : `\${${best.name}}`;
}

function expand(p) {
  let out = p;
  for (let pass = 0; pass < 8 && out.includes("${"); pass++) {
    let changed = false;
    out = out.replace(/\$\{([^}]*)\}/g, (whole, name) => {
      const key = Object.keys(roots).find(
        (k) => k.toLowerCase() === name.trim().toLowerCase()
      );
      if (!key) return whole;
      changed = true;
      return roots[key].replace(/[\\/]+$/, "");
    });
    if (!changed) break;
  }
  return out;
}

const changes = [];
for (const item of items) {
  for (const field of PATH_FIELDS) {
    const value = item[field];
    if (!value || typeof value !== "string") continue;
    if (!isAbs(value) || URL_RE.test(value)) continue;

    const varForm = toVarPath(value);
    if (varForm === value) continue;
    // Safety: must expand back to the original path
    if (cleanPath(expand(varForm)).toLowerCase() !== cleanPath(value).toLowerCase()) {
      console.error(`[SKIP] round-trip mismatch: ${value} -> ${varForm}`);
      continue;
    }
    changes.push({ field, from: value, to: varForm });
    item[field] = varForm;
  }
}

console.log(`config : ${configPath}`);
console.log(`mode   : ${args.write ? "WRITE" : "dry run (pass --write to apply)"}\n`);

if (detected.length > 0) {
  console.log("detected roots:");
  for (const { name, dir, uses } of detected) {
    console.log(`  \${${name.padEnd(10)}} = ${dir.padEnd(28)} (${uses} uses)`);
  }
  console.log("");
}

if (changes.length === 0) {
  console.log("nothing to rewrite.");
} else {
  const width = Math.min(60, Math.max(...changes.map((c) => c.from.length)));
  for (const c of changes) {
    console.log(`  [${c.field}] ${c.from.padEnd(width)}  ->  ${c.to}`);
  }
  console.log(`\nrewritten: ${changes.length}`);
}

const leftover = collectAbsolutePaths().filter((p) => !/^c:\\windows/i.test(p));
console.log(`still absolute (non-system): ${leftover.length}`);

// Per-machine overrides: setting QL_<NAME> lets one config.json serve several
// machines without editing it.
if (Object.keys(roots).length > 0) {
  console.log("\nto override on another machine (no config edit needed):");
  for (const [name, dir] of Object.entries(roots)) {
    console.log(`  setx QL_${name} "${dir}"`);
  }
}

if (args.write && (changes.length > 0 || detected.length > 0)) {
  config.roots = roots;
  const backup = `${configPath}.${Date.now()}.bak`;
  copyFileSync(configPath, backup);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`\nbackup : ${backup}`);
  console.log(`written: ${configPath}`);
}

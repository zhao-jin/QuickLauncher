import { getPortableDir } from "@/lib/ipc";

/**
 * Portable 路径工具。
 *
 * config.json 里的路径有三种可移植写法：
 *   - `${NAME}\x`  命名根目录，换机器只改 roots 表（跨盘符也适用）
 *   - `.\x` / `..\x`  相对 exe 所在目录
 *   - 绝对路径     原样使用
 * UI 上一律额外展示展开/解析后的绝对路径。
 */

/** exe 所在目录，进程生命周期内不变，启动时取一次 */
let pathBase = "";

/** 命名根目录表，与后端保持同一份（来自 config.roots） */
let pathRoots: Record<string, string> = {};

export async function initPathBase(): Promise<void> {
  try {
    pathBase = await getPortableDir();
  } catch {
    pathBase = "";
  }
}

export function getPathBase(): string {
  return pathBase;
}

export function setPathRoots(roots: Record<string, string> | undefined): void {
  pathRoots = roots ?? {};
}

export function getPathRoots(): Record<string, string> {
  return pathRoots;
}

const URL_RE = /^(?:https?|file):\/\//i;
const VAR_RE = /\$\{([^}]*)\}/g;
const MAX_EXPAND_PASSES = 8;

/** 盘符开头（C:\ 或 C:/）或 UNC（\\server\share） */
function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** 大小写不敏感查表，与 Windows 路径习惯一致 */
function lookupVar(name: string): string | undefined {
  const key = name.trim();
  if (key in pathRoots) return pathRoots[key];
  const hit = Object.keys(pathRoots).find(
    (k) => k.toLowerCase() === key.toLowerCase()
  );
  return hit ? pathRoots[hit] : undefined;
}

/** 展开 `${NAME}`；未定义的变量原样保留，交由调用方提示 */
export function expandVars(p: string): string {
  let current = p;
  for (let pass = 0; pass < MAX_EXPAND_PASSES; pass++) {
    if (!current.includes("${")) break;
    let changed = false;
    current = current.replace(VAR_RE, (whole, name: string) => {
      const value = lookupVar(name);
      if (value === undefined) return whole;
      changed = true;
      return value.replace(/[\\/]+$/, "");
    });
    if (!changed) break;
  }
  return current;
}

/** 展开后仍未解析的变量名（即未定义的） */
export function unresolvedVars(p: string): string[] {
  const names: string[] = [];
  for (const m of expandVars(p).matchAll(VAR_RE)) {
    names.push(m[1].trim());
  }
  return names;
}

/** 是否含变量引用 */
export function hasVars(p: string): boolean {
  return /\$\{[^}]*\}/.test(p);
}

/**
 * 需要按 portable 目录解析的相对路径：非绝对、非 URL，且含分隔符或是 `.`/`..`。
 * 不含分隔符的裸名（如 `python`）交给 Shell 走 PATH，不算相对路径。
 * 判断基于展开后的结果，因为 `${RED}\x` 展开后通常是绝对路径。
 */
export function isRelativePath(p: string): boolean {
  const t = expandVars(p.trim());
  if (!t || URL_RE.test(t) || isAbsolute(t)) return false;
  return t.includes("\\") || t.includes("/") || t === "." || t === "..";
}

/** 消解 `.` 与 `..`，统一为反斜杠 */
function cleanPath(p: string): string {
  const win = p.replace(/\//g, "\\");
  const prefix = win.match(/^(?:[a-zA-Z]:|\\\\[^\\]+\\[^\\]+)/)?.[0] ?? "";
  const out: string[] = [];
  for (const seg of win.slice(prefix.length).split("\\")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `${prefix}\\${out.join("\\")}`;
}

/**
 * 展开变量并解析为绝对路径。
 * URL / 裸命令 / 含未定义变量时原样返回。
 */
export function toAbsolutePath(p: string): string {
  const expanded = expandVars(p.trim());
  if (!expanded || URL_RE.test(expanded)) return expanded;
  // 变量没展开干净，无法判定，原样返回让 UI 提示
  if (hasVars(expanded)) return expanded;
  if (isAbsolute(expanded)) return cleanPath(expanded);
  const isPath =
    expanded.includes("\\") ||
    expanded.includes("/") ||
    expanded === "." ||
    expanded === "..";
  if (!isPath || !pathBase) return expanded;
  return cleanPath(`${pathBase}\\${expanded}`);
}

/**
 * 绝对路径 → 相对 portable 目录（必要时用 `..` 跳出）。
 * 跨盘符 / UNC 不同根时无法相对化，原样返回。
 */
export function toRelativePath(p: string): string {
  const t = p.trim();
  if (!pathBase || !isAbsolute(t) || URL_RE.test(t)) return t;

  const from = cleanPath(pathBase).split("\\");
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

  const ups: string[] = Array(from.length - i).fill("..");
  const segs = [...ups, ...to.slice(i)];
  if (segs.length === 0) return ".";
  // 无 `..` 前缀时必须带 `.\`，否则会被当成 PATH 里的裸命令
  return segs[0] === ".." ? segs.join("\\") : `.\\${segs.join("\\")}`;
}

/** 能否相对化（同盘符的绝对路径才行），用于控制按钮可用状态 */
export function canRelativize(p: string): boolean {
  const t = p.trim();
  if (!pathBase || !isAbsolute(t) || URL_RE.test(t)) return false;
  return toRelativePath(t) !== t;
}

/**
 * 用已定义的根目录把绝对路径改写成 `${NAME}\...`。
 * 匹配最长的根，未命中则原样返回。
 */
export function toVarPath(p: string): string {
  const t = p.trim();
  if (!isAbsolute(t) || URL_RE.test(t)) return t;
  const target = cleanPath(t);
  const lower = target.toLowerCase();

  let best: { name: string; len: number } | null = null;
  for (const [name, value] of Object.entries(pathRoots)) {
    if (!value || !isAbsolute(value)) continue;
    const root = cleanPath(value).replace(/\\+$/, "");
    const rootLower = root.toLowerCase();
    const isPrefix =
      lower === rootLower || lower.startsWith(`${rootLower}\\`);
    if (!isPrefix) continue;
    if (!best || root.length > best.len) best = { name, len: root.length };
  }
  if (!best) return t;

  const rest = target.slice(best.len).replace(/^\\+/, "");
  return rest ? `\${${best.name}}\\${rest}` : `\${${best.name}}`;
}

/** 是否能用某个已定义根目录替换 */
export function canUseVar(p: string): boolean {
  return toVarPath(p) !== p.trim();
}

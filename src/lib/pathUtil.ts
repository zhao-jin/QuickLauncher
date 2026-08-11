import { getPortableDir } from "@/lib/ipc";

/**
 * Portable 路径工具。
 *
 * config.json 里可以写相对路径（相对 exe 所在目录），包括用 `..` 指向 exe 目录之外。
 * 这样整个文件夹拷到别的机器仍然可用。UI 上一律额外展示解析后的绝对路径。
 */

/** exe 所在目录，进程生命周期内不变，启动时取一次 */
let pathBase = "";

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

const URL_RE = /^(?:https?|file):\/\//i;

/** 盘符开头（C:\ 或 C:/）或 UNC（\\server\share） */
function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/**
 * 需要按 portable 目录解析的相对路径：非绝对、非 URL，且含分隔符或是 `.`/`..`。
 * 不含分隔符的裸名（如 `python`）交给 Shell 走 PATH，不算相对路径。
 */
export function isRelativePath(p: string): boolean {
  const t = p.trim();
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

/** 相对路径 → 基于 portable 目录的绝对路径；URL / 绝对路径 / 裸命令原样返回 */
export function toAbsolutePath(p: string): string {
  const t = p.trim();
  if (!isRelativePath(t) || !pathBase) return t;
  return cleanPath(`${pathBase}\\${t}`);
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

/** 默认键位矩阵
 *  最多 5 行 × 14 列。每个键位全局唯一，避免冲突。
 *  设置里 cols 6-14 / rows 2-5，运行时 slice。
 */
export const DEFAULT_KEY_ROWS: string[][] = [
  // QWERTY 主行（10 列 + 4 个符号键）
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "BKSP"],
  // ASDF 行
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "ENTER", "PGUP", "PGDN"],
  // ZXC 行
  ["Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "UP", "DOWN", "LEFT", "RIGHT"],
  // 数字行
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "HOME", "END"],
  // 小键盘行（以 N 前缀区分）
  ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N0", "N+", "N-", "N*", "N/"],
];

/** 顶部 F 行 */
export const TOP_BAR_KEYS: string[] = Array.from(
  { length: 14 },
  (_, i) => `F${i + 1}`
);

/** 根据 rows/cols 截取键位矩阵 */
export function makeKeyMatrix(rows: number, cols: number): string[][] {
  return DEFAULT_KEY_ROWS.slice(0, rows).map((row) => row.slice(0, cols));
}

/** 把 KeyboardEvent 转成我们使用的 hotkey 字符串 */
export function keyFromEvent(e: KeyboardEvent): string | null {
  // F 键
  if (/^F\d{1,2}$/.test(e.key)) return e.key.toUpperCase();
  // 小键盘
  if (e.code.startsWith("Numpad")) {
    const m = e.code.match(/^Numpad(\d)$/);
    if (m) return `N${m[1]}`;
    if (e.code === "NumpadAdd") return "N+";
    if (e.code === "NumpadSubtract") return "N-";
    if (e.code === "NumpadMultiply") return "N*";
    if (e.code === "NumpadDivide") return "N/";
  }
  // 数字键（非小键盘）
  if (!e.code.startsWith("Numpad") && /^\d$/.test(e.key)) return e.key;
  // 方向键 / 编辑键
  const named: Record<string, string> = {
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    Home: "HOME",
    End: "END",
    PageUp: "PGUP",
    PageDown: "PGDN",
    Backspace: "BKSP",
    Enter: "ENTER",
  };
  if (named[e.key]) return named[e.key];
  // 单字符（字母/标点）
  if (e.key.length === 1) {
    const ch = e.key.toUpperCase();
    if (/[A-Z]/.test(ch)) return ch;
    if (";,./'[]\\-=".includes(ch)) return ch;
  }
  return null;
}



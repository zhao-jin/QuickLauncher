import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConfig } from "@/store/useConfig";
import { getPortableDir, pickFolder } from "@/lib/ipc";
import type { AppConfig } from "@/types/config";

interface Props {
  onClose: () => void;
}

export default function SettingsDialog({ onClose }: Props) {
  const config = useConfig((s) => s.config);
  const update = useConfig((s) => s.updateSettings);

  const [draft, setDraft] = useState<AppConfig>(config);
  const [portableDir, setPortableDir] = useState<string>("");

  useEffect(() => {
    getPortableDir().then(setPortableDir).catch(() => {});
  }, []);

  const patch = <K extends keyof AppConfig>(k: K, v: AppConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const apply = async (closeAfter = true) => {
    console.log("[settings] apply", {
      old: config,
      new: draft,
      layoutChanged:
        config.layout.cols !== draft.layout.cols ||
        config.layout.rows !== draft.layout.rows,
      hotkeyChanged: config.hotkey !== draft.hotkey,
    });
    // 热键变更时重绑到系统
    if (draft.hotkey !== config.hotkey) {
      try {
        await invoke("set_hotkey", { combo: draft.hotkey });
      } catch (err) {
        alert(`热键绑定失败: ${err}`);
        return;
      }
    }
    update(draft);
    if (closeAfter) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="panel w-[560px] max-w-[94vw] max-h-[calc(100vh-2rem)] flex flex-col p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header：固定 */}
        <div className="flex items-center justify-between px-4 h-9 border-b border-white/10 shrink-0">
          <div className="text-sm text-white/90">设置</div>
          <button
            className="w-6 h-6 rounded hover:bg-white/15 text-white/80"
            onClick={onClose}
            title="关闭"
          >
            ×
          </button>
        </div>

        {/* Content：可滚动 */}
        <div className="p-4 space-y-4 text-sm overflow-y-auto flex-1 min-h-0">
          {/* 快捷键 */}
          <Section title="全局快捷键">
            <HotkeyCapture
              value={draft.hotkey}
              onChange={(v) => patch("hotkey", v)}
            />
            <div className="text-xs text-white/50">
              支持组合：Ctrl / Shift / Alt / Win + 字母/数字/功能键（F1-F12）/ 特殊符号。
            </div>
          </Section>

          {/* 布局 */}
          <Section title="布局">
            <div className="flex items-center gap-4">
              <NumberStepper
                label="列数"
                min={6}
                max={14}
                value={draft.layout.cols}
                onChange={(v) =>
                  patch("layout", { ...draft.layout, cols: v })
                }
              />
              <NumberStepper
                label="行数"
                min={2}
                max={5}
                value={draft.layout.rows}
                onChange={(v) =>
                  patch("layout", { ...draft.layout, rows: v })
                }
              />
              <div className="text-xs text-white/50">
                当前 {draft.layout.cols}×{draft.layout.rows} ={" "}
                {draft.layout.cols * draft.layout.rows} 格
              </div>
            </div>
          </Section>

          {/* 行为 */}
          <Section title="行为">
            <Check
              checked={draft.behavior.hideOnFocusLost}
              onChange={(v) =>
                patch("behavior", { ...draft.behavior, hideOnFocusLost: v })
              }
              label="失去焦点时自动隐藏"
            />
            <Check
              checked={draft.behavior.hideAfterLaunch}
              onChange={(v) =>
                patch("behavior", { ...draft.behavior, hideAfterLaunch: v })
              }
              label="启动命令后自动隐藏窗口"
            />
          </Section>

          {/* 外观 */}
          <Section title="外观">
            <div className="flex items-center gap-3">
              <span className="text-white/85 w-16">不透明度</span>
              <input
                type="range"
                min={0.6}
                max={1}
                step={0.02}
                value={draft.appearance.opacity}
                onChange={(e) =>
                  patch("appearance", {
                    ...draft.appearance,
                    opacity: parseFloat(e.target.value),
                  })
                }
                className="flex-1 accent-blue-500"
              />
              <span className="text-white/60 text-xs w-10 text-right">
                {Math.round(draft.appearance.opacity * 100)}%
              </span>
            </div>
          </Section>

          {/* 路径变量 */}
          <Section title="路径变量">
            <RootsEditor
              roots={draft.roots ?? {}}
              onChange={(v) => patch("roots", v)}
            />
          </Section>

          {/* 路径 */}
          <Section title="存储">
            <div className="text-xs text-white/55 break-all font-mono bg-white/5 rounded px-2 py-1.5 border border-white/10">
              {portableDir || "..."}
            </div>
            <div className="text-[11px] text-white/40">
              配置文件 <code>config.json</code> 与图标缓存 <code>icons/</code>{" "}
              都在这个目录下。
            </div>
          </Section>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
          <button
            className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/15 text-sm"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
            onClick={() => apply(false)}
            title="应用但不关闭对话框"
          >
            应用
          </button>
          <button
            className="px-4 py-1.5 rounded bg-blue-500/90 hover:bg-blue-500 text-white text-sm"
            onClick={() => apply(true)}
          >
            保存并关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 命名根目录编辑器。
 *
 * 内部用数组维护顺序与编辑中间态（允许暂时空名/重名），
 * 每次变更折叠成 Record 抛给上层；空名行被忽略，重名后者生效并标红。
 */
function RootsEditor({
  roots,
  onChange,
}: {
  roots: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const [entries, setEntries] = useState<Array<[string, string]>>(() =>
    Object.entries(roots)
  );

  const emit = (next: Array<[string, string]>) => {
    setEntries(next);
    const out: Record<string, string> = {};
    for (const [name, value] of next) {
      const key = name.trim();
      if (key) out[key] = value.trim();
    }
    onChange(out);
  };

  const setAt = (index: number, name: string, value: string) =>
    emit(entries.map((e, i) => (i === index ? [name, value] : e)));

  const nameCounts = new Map<string, number>();
  for (const [name] of entries) {
    const key = name.trim().toLowerCase();
    if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return (
    <>
      <div className="text-[11px] text-white/45">
        给常用根目录起名，条目路径里用 <code className="text-white/70">{"${名字}"}</code>{" "}
        引用。换机器只改这里，跨盘符也适用。
      </div>

      {entries.length === 0 && (
        <div className="text-xs text-white/35 py-1">尚未定义任何变量。</div>
      )}

      <div className="space-y-1.5">
        {entries.map(([name, value], index) => {
          const trimmed = name.trim();
          const duplicated = (nameCounts.get(trimmed.toLowerCase()) ?? 0) > 1;
          const badName = trimmed !== "" && !/^[A-Za-z0-9_-]+$/.test(trimmed);
          return (
            <div key={index} className="flex items-center gap-1.5">
              <input
                className={`w-28 shrink-0 bg-black/40 border rounded px-2 py-1 font-mono text-xs outline-none focus:border-blue-400/60 ${
                  duplicated || badName ? "border-amber-400/70" : "border-white/15"
                }`}
                value={name}
                spellCheck={false}
                placeholder="名字"
                title={
                  duplicated
                    ? "名字重复，后面的会覆盖前面的"
                    : badName
                      ? "只允许字母、数字、下划线和连字符"
                      : ""
                }
                onChange={(e) => setAt(index, e.target.value, value)}
              />
              <input
                className="flex-1 min-w-0 bg-black/40 border border-white/15 rounded px-2 py-1 font-mono text-xs outline-none focus:border-blue-400/60"
                value={value}
                spellCheck={false}
                placeholder="目标目录，如 I:\RED"
                onChange={(e) => setAt(index, name, e.target.value)}
              />
              <button
                className="px-2 py-1 text-xs bg-white/10 hover:bg-white/15 rounded shrink-0"
                title="选择目录"
                onClick={async () => {
                  const picked = await pickFolder();
                  if (picked) setAt(index, name, picked);
                }}
              >
                ...
              </button>
              <button
                className="w-6 h-6 rounded text-red-400 hover:bg-red-500/15 shrink-0"
                title="删除"
                onClick={() => emit(entries.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <button
        className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/15 rounded"
        onClick={() => emit([...entries, ["", ""]])}
      >
        + 添加变量
      </button>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-white/55">
        {title}
      </div>
      {children}
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-white/85 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500"
      />
      {label}
    </label>
  );
}

function NumberStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/85 text-xs">{label}</span>
      <button
        className="w-7 h-7 rounded bg-white/10 hover:bg-white/15 text-white/85"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        −
      </button>
      <span className="w-8 text-center text-white/90 font-mono">{value}</span>
      <button
        className="w-7 h-7 rounded bg-white/10 hover:bg-white/15 text-white/85"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        +
      </button>
    </div>
  );
}

/** 热键捕获输入框：聚焦后按下组合键即捕获 */
function HotkeyCapture({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // 忽略单独的修饰键按下
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");
      if (e.metaKey) parts.push("Win");

      let mainKey = e.key;
      // 把 " " 叫 "Space"，把 "Escape" 识别
      if (mainKey === " ") mainKey = "Space";
      // Backquote 特殊：e.key === "`"
      if (mainKey.length === 1) mainKey = mainKey.toUpperCase();

      parts.push(mainKey);

      // 至少要有一个修饰键 + 一个普通键，否则不算合法
      if (parts.length < 2) return;

      onChange(parts.join("+"));
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  return (
    <div className="flex items-center gap-2">
      <button
        ref={inputRef}
        className={`flex-1 text-left px-3 py-1.5 rounded border font-mono text-sm ${
          recording
            ? "border-blue-400/70 bg-blue-500/15 text-white animate-pulse"
            : "border-white/15 bg-white/5 text-white/90 hover:bg-white/10"
        }`}
        onClick={() => setRecording((r) => !r)}
      >
        {recording ? "请按下组合键..." : value || "（未设置）"}
      </button>
      <button
        className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-xs text-white/85"
        onClick={() => onChange("Ctrl+`")}
        title="恢复默认"
      >
        默认
      </button>
    </div>
  );
}

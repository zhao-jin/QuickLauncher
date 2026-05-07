import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  /** 分隔线（只显示一条线，不接收点击） */
  separator?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 危险项：红色样式（如删除） */
  danger?: boolean;
  /** 右侧快捷键文案 */
  shortcut?: string;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 通用上下文菜单。
 * - 外部定位由调用方传入 (x, y)，组件会自动防止出屏
 * - 点击任意菜单项 / 按 Esc / 点击外部 → 关闭
 */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 定位修正：避免超出视口
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 4) left = vw - rect.width - 4;
    if (top + rect.height > vh - 4) top = vh - rect.height - 4;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    setPos({ left, top });
  }, [x, y]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    // 全屏拦截，点击遮罩关闭
    <div
      className="fixed inset-0 z-[70]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        className="absolute min-w-[180px] panel py-1 text-sm"
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it, i) => {
          if (it.separator) {
            return (
              <div
                key={`sep-${i}`}
                className="my-1 border-t border-white/10"
              />
            );
          }
          const base =
            "px-3 py-1.5 flex items-center justify-between gap-6 cursor-pointer select-none";
          const cls = it.disabled
            ? "text-white/30 cursor-not-allowed"
            : it.danger
            ? "text-red-300 hover:bg-red-500/20"
            : "text-white/90 hover:bg-white/10";
          return (
            <div
              key={i}
              className={`${base} ${cls}`}
              onClick={() => {
                if (it.disabled) return;
                it.onClick?.();
                onClose();
              }}
            >
              <span>{it.label}</span>
              {it.shortcut && (
                <span className="text-xs text-white/40">{it.shortcut}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  enumerateResourceIcons,
  extractResourceIconsRange,
} from "@/lib/ipc";

interface Props {
  /** 初始资源文件（.dll/.exe），默认 shell32.dll */
  initialFile?: string;
  /** 初始选中 index */
  initialIndex?: number;
  onOk: (file: string, index: number) => void;
  onCancel: () => void;
}

const DEFAULT_FILE = "C:\\Windows\\System32\\shell32.dll";
const BATCH = 32; // 每批加载 32 个图标，避免一次性提取上千个

interface IconItem {
  index: number;
  url: string;
}

export default function IconPickerDialog({
  initialFile,
  initialIndex,
  onOk,
  onCancel,
}: Props) {
  const [file, setFile] = useState(initialFile?.trim() || DEFAULT_FILE);
  const [draftFile, setDraftFile] = useState(file);
  const [total, setTotal] = useState<number>(0);
  const [icons, setIcons] = useState<IconItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(initialIndex ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  // 当 file 变化时重新枚举 + 加载第一批
  useEffect(() => {
    let cancelled = false;
    setIcons([]);
    setTotal(0);
    setError(null);
    setLoading(true);
    loadingRef.current = true;
    (async () => {
      try {
        const cnt = await enumerateResourceIcons(file);
        if (cancelled) return;
        setTotal(cnt);
        // 第一批
        const first = await extractResourceIconsRange(
          file,
          0,
          Math.min(BATCH, cnt)
        );
        if (cancelled) return;
        setIcons(first);
      } catch (e: any) {
        if (cancelled) return;
        setError(String(e?.message || e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // 滚动接近底部时自动加载下一批
  const onScroll = async (e: React.UIEvent<HTMLDivElement>) => {
    if (loadingRef.current) return;
    const t = e.currentTarget;
    if (t.scrollHeight - t.scrollTop - t.clientHeight > 80) return;
    if (icons.length >= total) return;

    loadingRef.current = true;
    setLoading(true);
    try {
      const more = await extractResourceIconsRange(
        file,
        icons.length,
        Math.min(BATCH, total - icons.length)
      );
      setIcons((prev) => [...prev, ...more]);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const browse = async () => {
    const res = await openDialog({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Icon resource (DLL/EXE/ICL/OCX/CPL)",
          extensions: ["dll", "exe", "icl", "ocx", "cpl", "mui"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (typeof res === "string") {
      setDraftFile(res);
      setFile(res);
    }
  };

  const applyDraftFile = () => {
    const v = draftFile.trim();
    if (v && v !== file) setFile(v);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2"
      onClick={onCancel}
    >
      <div
        className="panel w-[640px] max-w-[96vw] flex flex-col p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        // 主窗口高度可能只有 ~440px，必须严格不超过视口
        style={{ maxHeight: "calc(100vh - 16px)", height: "100%" }}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-4 h-9 border-b border-white/10 shrink-0">
          <div className="text-sm text-white/90">更改图标</div>
          <button
            className="w-6 h-6 rounded hover:bg-white/15 text-white/80"
            onClick={onCancel}
            title="取消"
          >
            ×
          </button>
        </div>

        {/* 文件输入 */}
        <div className="px-4 py-3 border-b border-white/10 shrink-0 space-y-2">
          <div className="text-xs text-white/70">
            查找此文件中的图标 (L)：
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-sm outline-none focus:border-blue-400/60"
              value={draftFile}
              onChange={(e) => setDraftFile(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyDraftFile();
                }
              }}
              spellCheck={false}
            />
            <button
              className="px-3 py-1 text-xs bg-white/10 hover:bg-white/15 rounded"
              onClick={applyDraftFile}
              title="加载该文件的图标"
            >
              加载
            </button>
            <button
              className="px-3 py-1 text-xs bg-white/10 hover:bg-white/15 rounded"
              onClick={browse}
            >
              浏览(B)…
            </button>
          </div>
        </div>

        {/* 图标网格 */}
        <div className="px-4 py-2 border-b border-white/10 shrink-0">
          <div className="text-xs text-white/70">
            从以下列表中选择一个图标 (S)
            <span className="ml-2 text-white/45">
              {error
                ? `加载失败：${error}`
                : total > 0
                ? `已加载 ${icons.length} / ${total}`
                : loading
                ? "加载中…"
                : ""}
            </span>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 overflow-auto px-3 py-2"
          onScroll={onScroll}
        >
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))",
            }}
          >
            {icons.map((it) => {
              const active = it.index === selectedIndex;
              return (
                <button
                  key={it.index}
                  onClick={() => setSelectedIndex(it.index)}
                  onDoubleClick={() => onOk(file, it.index)}
                  title={`#${it.index}`}
                  className={`aspect-square rounded flex items-center justify-center border ${
                    active
                      ? "border-blue-400/80 bg-blue-500/20"
                      : "border-white/10 hover:border-white/30 hover:bg-white/5"
                  }`}
                >
                  <img
                    src={it.url}
                    alt={`icon-${it.index}`}
                    className="object-contain"
                    style={{ width: 36, height: 36 }}
                    draggable={false}
                  />
                </button>
              );
            })}
          </div>
          {loading && icons.length > 0 && (
            <div className="text-center text-white/45 text-xs py-2">
              加载更多…
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 shrink-0">
          <div className="text-[11px] text-white/45">
            提示：双击图标快速选定。索引 #{selectedIndex}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/15 text-sm"
              onClick={onCancel}
            >
              取消
            </button>
            <button
              className="px-4 py-1.5 rounded bg-blue-500/90 hover:bg-blue-500 text-white text-sm"
              onClick={() => onOk(file, selectedIndex)}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

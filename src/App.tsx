import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useConfig } from "@/store/useConfig";
import { launchItem, revealInExplorer } from "@/lib/ipc";
import { emptyItem, type LaunchItem } from "@/types/config";
import { keyFromEvent, makeKeyMatrix, TOP_BAR_KEYS } from "@/lib/hotkey";
import { useItemIcon } from "@/lib/useIcon";
import EditItemDialog from "@/components/EditItemDialog";
import SettingsDialog from "@/components/SettingsDialog";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";

export default function App() {
  const config = useConfig((s) => s.config);
  const loaded = useConfig((s) => s.loaded);
  const activeTabIndex = useConfig((s) => s.activeTabIndex);
  const loadFromDisk = useConfig((s) => s.loadFromDisk);
  const setActiveTab = useConfig((s) => s.setActiveTab);
  const upsertItemInActiveTab = useConfig((s) => s.upsertItemInActiveTab);
  const removeItemInActiveTab = useConfig((s) => s.removeItemInActiveTab);
  const upsertTopBarItem = useConfig((s) => s.upsertTopBarItem);
  const removeTopBarItem = useConfig((s) => s.removeTopBarItem);
  const moveItem = useConfig((s) => s.moveItem);
  const addTab = useConfig((s) => s.addTab);
  const renameTab = useConfig((s) => s.renameTab);
  const removeTab = useConfig((s) => s.removeTab);

  // 启动时加载配置
  useEffect(() => {
    loadFromDisk();
  }, [loadFromDisk]);

  // 失焦自动隐藏（仅当配置启用时）
  useEffect(() => {
    if (!config.behavior.hideOnFocusLost) return;
    const win = getCurrentWindow();
    let cleanup: (() => void) | undefined;
    win
      .onFocusChanged(({ payload: focused }) => {
        // 编辑对话框/设置对话框/右键菜单打开时不隐藏
        if (
          !focused &&
          !editingRef.current &&
          !settingsOpenRef.current &&
          !menuOpenRef.current
        ) {
          win.hide();
        }
      })
      .then((un) => {
        cleanup = un;
      });
    return () => cleanup?.();
  }, [config.behavior.hideOnFocusLost]);

  const keyMatrix = useMemo(
    () => makeKeyMatrix(config.layout.rows, config.layout.cols),
    [config.layout.rows, config.layout.cols]
  );
  const topKeys = useMemo(
    () => TOP_BAR_KEYS.slice(0, config.layout.cols),
    [config.layout.cols]
  );

  const activeTab = config.tabs[activeTabIndex];
  const activeMap = useMemo(() => {
    const m = new Map<string, LaunchItem>();
    activeTab?.items.forEach((it) => m.set(it.key, it));
    return m;
  }, [activeTab]);
  const topMap = useMemo(() => {
    const m = new Map<string, LaunchItem>();
    config.topBar.forEach((it) => m.set(it.key, it));
    return m;
  }, [config.topBar]);

  const [editing, setEditing] = useState<{
    item: LaunchItem;
    area: "grid" | "top";
  } | null>(null);
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  /** 内存剪贴板：存被复制 / 剪切的 LaunchItem（不含 key） */
  const [clipboard, setClipboard] = useState<LaunchItem | null>(null);

  /** 上下文菜单状态 */
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    hotkey: string;
    area: "grid" | "top";
  } | null>(null);
  const menuOpenRef = useRef(false);
  useEffect(() => {
    menuOpenRef.current = !!menu;
  }, [menu]);

  // 托盘菜单"设置..."事件
  useEffect(() => {
    const unlistenP = listen("open-settings", () => setSettingsOpen(true));
    return () => {
      unlistenP.then((u) => u());
    };
  }, []);

  // 根据布局动态调整窗口尺寸
  useEffect(() => {
    if (!loaded) return;
    const { cols, rows } = config.layout;
    // 单元格 ~72×52 + 边距；顶栏 + F 行 + Tab 栏固定约 120
    const w = Math.max(640, Math.round(cols * 72 + 24));
    const h = Math.round(rows * 58 + 140);
    const win = getCurrentWindow();
    (async () => {
      try {
        await win.setSize(new LogicalSize(w, h));
        await win.center();
      } catch (err) {
        console.warn("setSize failed", err);
      }
    })();
  }, [config.layout.cols, config.layout.rows, loaded]);

  // 透明度写到 CSS var，让 panel 遮罩随配置调整
  useEffect(() => {
    // 原始 opacity (0.6~1.0) 映射到 panel 遮罩 alpha：
    // Mica 在后面提供质感，panel 只是一层很淡的暗色遮罩。
    // 用户值 1.0 → 遮罩 0.9（几乎不透明）；0.6 → 遮罩 0.2（基本透）
    const a = Math.max(0, Math.min(1, (config.appearance.opacity - 0.5) * 1.8));
    document.documentElement.style.setProperty("--panel-alpha", a.toFixed(2));
  }, [config.appearance.opacity]);

  const run = async (item?: LaunchItem) => {
    if (!item || !item.target) return;
    try {
      await launchItem(item);
      if (config.behavior.hideAfterLaunch) {
        getCurrentWindow().hide();
      }
    } catch (err) {
      console.error("launch failed", err);
      alert(`启动失败: ${err}`);
    }
  };

  // 键盘监听
  useEffect(() => {
    const win = getCurrentWindow();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        win.hide();
        return;
      }
      if (editing || settingsOpen) return;

      if (e.ctrlKey && /^\d$/.test(e.key)) {
        const idx = e.key === "0" ? 9 : parseInt(e.key, 10) - 1;
        if (idx < config.tabs.length) {
          e.preventDefault();
          setActiveTab(idx);
        }
        return;
      }

      if (/^F\d{1,2}$/.test(e.key)) {
        const it = topMap.get(e.key.toUpperCase());
        if (it) {
          e.preventDefault();
          run(it);
        }
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const k = keyFromEvent(e);
      if (k) {
        const it = activeMap.get(k);
        if (it) {
          e.preventDefault();
          run(it);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeMap, topMap, config.tabs.length, editing, settingsOpen, config.behavior.hideAfterLaunch, setActiveTab]);

  const handleCellClick = (hotkey: string, area: "grid" | "top") => {
    const item = area === "grid" ? activeMap.get(hotkey) : topMap.get(hotkey);
    if (item) run(item);
    else setEditing({ item: emptyItem(hotkey), area });
  };

  const handleCellContext = (
    e: React.MouseEvent,
    hotkey: string,
    area: "grid" | "top"
  ) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, hotkey, area });
  };

  /** 根据右键菜单构造菜单项 */
  const buildMenuItems = (): ContextMenuItem[] => {
    if (!menu) return [];
    const { hotkey, area } = menu;
    const item = area === "grid" ? activeMap.get(hotkey) : topMap.get(hotkey);
    const hasItem = !!item;
    const hasClip = !!clipboard;

    if (hasItem) {
      // "打开文件位置" 对 URL 不适用（禁用）
      const isUrl = /^https?:\/\//i.test(item!.target);
      return [
        {
          label: "启动",
          onClick: () => item && run(item),
        },
        {
          label: "打开文件位置",
          disabled: isUrl || !item!.target,
          onClick: async () => {
            try {
              await revealInExplorer(item!.target);
            } catch (e) {
              alert(`无法打开文件位置：${e}`);
            }
          },
        },
        { separator: true, label: "" },
        {
          label: "编辑…",
          onClick: () => setEditing({ item: item!, area }),
        },
        {
          label: "复制",
          shortcut: "Ctrl+C",
          onClick: () => setClipboard({ ...item!, key: "" }),
        },
        {
          label: "剪切",
          shortcut: "Ctrl+X",
          onClick: () => {
            setClipboard({ ...item!, key: "" });
            if (area === "grid") removeItemInActiveTab(hotkey);
            else removeTopBarItem(hotkey);
          },
        },
        {
          label: "粘贴（覆盖）",
          shortcut: "Ctrl+V",
          disabled: !hasClip,
          onClick: () => {
            if (!clipboard) return;
            const pasted: LaunchItem = { ...clipboard, key: hotkey };
            if (area === "grid") upsertItemInActiveTab(pasted);
            else upsertTopBarItem(pasted);
          },
        },
        { separator: true, label: "" },
        {
          label: "删除",
          danger: true,
          onClick: () => {
            if (area === "grid") removeItemInActiveTab(hotkey);
            else removeTopBarItem(hotkey);
          },
        },
      ];
    }

    // 空格子
    return [
      {
        label: "新建…",
        onClick: () => setEditing({ item: emptyItem(hotkey), area }),
      },
      {
        label: "粘贴",
        shortcut: "Ctrl+V",
        disabled: !hasClip,
        onClick: () => {
          if (!clipboard) return;
          const pasted: LaunchItem = { ...clipboard, key: hotkey };
          if (area === "grid") upsertItemInActiveTab(pasted);
          else upsertTopBarItem(pasted);
        },
      },
    ];
  };

  // Ctrl+C/X/V 快捷键暂不实现"隔空粘贴"——用户通过右键菜单操作更明确。
  // 若后续要支持热键 + 最近 hover 格子，可记录 lastHoveredCell 然后分发。

  /** 内部拖拽数据格式（区分外部文件拖入） */
  const INTERNAL_DRAG_MIME = "application/x-ql-move";

  const handleCellDragStart = (
    e: React.DragEvent,
    hotkey: string,
    area: "grid" | "top"
  ) => {
    const item = area === "grid" ? activeMap.get(hotkey) : topMap.get(hotkey);
    if (!item) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      INTERNAL_DRAG_MIME,
      JSON.stringify({ area, key: hotkey, tabIndex: activeTabIndex })
    );
    // 保留人类可读备选
    e.dataTransfer.setData("text/plain", item.target);
  };

  /** 拖放处理：区分内部搬移 vs 外部文件导入 */
  const handleCellDrop = (
    e: React.DragEvent,
    hotkey: string,
    area: "grid" | "top"
  ) => {
    e.preventDefault();

    // 优先识别内部拖拽
    const internal = e.dataTransfer.getData(INTERNAL_DRAG_MIME);
    if (internal) {
      try {
        const src = JSON.parse(internal) as {
          area: "grid" | "top";
          key: string;
          tabIndex: number;
        };
        // 跨 Tab 的 grid 移动暂不支持（需要先切 Tab 再拖）
        if (src.area === "grid" && src.tabIndex !== activeTabIndex) {
          return;
        }
        moveItem(
          { area: src.area, key: src.key },
          { area, key: hotkey }
        );
      } catch (err) {
        console.error("invalid internal drag payload", err);
      }
      return;
    }

    // 外部文件：拖入文件或路径
    const f = e.dataTransfer.files?.[0];
    const p = (f as any)?.path ?? e.dataTransfer.getData("text/plain");
    if (!p) return;
    const next: LaunchItem = {
      ...emptyItem(hotkey),
      target: p,
      name: baseName(p),
    };
    if (area === "grid") upsertItemInActiveTab(next);
    else upsertTopBarItem(next);
  };

  return (
    <div className="w-screen h-screen p-[1px]">
      <div className="panel w-full h-full flex flex-col overflow-hidden">
        {/* 顶部拖拽条 */}
        <div className="drag-region flex items-center justify-between px-3 h-8 border-b border-white/10">
          <div className="text-xs text-white/90 tracking-wider">
            Quick Launcher
            {activeTab && (
              <span className="text-white/55 ml-2">· {activeTab.name}</span>
            )}
            {!loaded && <span className="text-white/40 ml-2">loading...</span>}
          </div>
          <div className="no-drag flex items-center gap-0.5">
            <button
              className="w-6 h-6 rounded hover:bg-white/15 text-white/90 text-sm"
              title="设置"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙
            </button>
            <button
              className="w-6 h-6 rounded hover:bg-white/15 text-white/90 text-sm"
              title="隐藏 (ESC)"
              onClick={() => getCurrentWindow().hide()}
            >
              −
            </button>
            <button
              className="w-6 h-6 rounded hover:bg-red-500/70 text-white/90 text-sm"
              title="最小化到托盘（彻底退出请右键托盘 → 退出）"
              onClick={() => getCurrentWindow().hide()}
            >
              ×
            </button>
          </div>
        </div>

        {/* F1-F10 顶栏 */}
        <div className="px-1.5 pt-1.5">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${config.layout.cols}, minmax(0, 1fr))` }}
          >
            {topKeys.map((k) => (
              <Cell
                key={k}
                hotkey={k}
                item={topMap.get(k)}
                onClick={() => handleCellClick(k, "top")}
                onContextMenu={(e) => handleCellContext(e, k, "top")}
                onDrop={(e) => handleCellDrop(e, k, "top")}
                onDragStart={(e) => handleCellDragStart(e, k, "top")}
              />
            ))}
          </div>
        </div>

        {/* Tab 栏 */}
        <div className="px-1.5 pt-1.5">
          <div className="flex items-center gap-1 border-b border-white/10 pb-1">
            {config.tabs.map((t, i) => (
              <button
                key={t.id}
                className={`px-2.5 py-0.5 text-xs rounded-md ${
                  i === activeTabIndex
                    ? "bg-white/15 text-white"
                    : "text-white/85 hover:bg-white/10"
                }`}
                onClick={() => setActiveTab(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const name = window.prompt("重命名 Tab（留空=删除）", t.name);
                  if (name === null) return;
                  if (name.trim() === "") {
                    if (config.tabs.length <= 1) {
                      alert("至少保留一个 Tab");
                      return;
                    }
                    if (confirm(`确认删除 Tab "${t.name}" 及其下所有命令?`)) {
                      removeTab(i);
                    }
                  } else {
                    renameTab(i, name.trim());
                  }
                }}
                title={`Ctrl+${i + 1} · 右键改名/删除`}
              >
                {t.name}
              </button>
            ))}
            <button
              className="px-2 py-0.5 text-xs text-white/60 hover:text-white"
              title="新建 Tab"
              onClick={() => {
                const name = window.prompt("新 Tab 名称:", "New");
                if (name && name.trim()) addTab(name.trim());
              }}
            >
              +
            </button>
          </div>
        </div>

        {/* 主网格 */}
        <div className="flex-1 p-1.5">
          <div
            className="grid gap-1 h-full"
            style={{ gridTemplateRows: `repeat(${config.layout.rows}, minmax(0, 1fr))` }}
          >
            {keyMatrix.map((row, ri) => (
              <div
                key={ri}
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${config.layout.cols}, minmax(0, 1fr))` }}
              >
                {row.map((k) => (
                  <Cell
                    key={k}
                    hotkey={k}
                    item={activeMap.get(k)}
                    onClick={() => handleCellClick(k, "grid")}
                    onContextMenu={(e) => handleCellContext(e, k, "grid")}
                    onDrop={(e) => handleCellDrop(e, k, "grid")}
                    onDragStart={(e) => handleCellDragStart(e, k, "grid")}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing && (
        <EditItemDialog
          key={`${editing.area}-${editing.item.key}-${activeTabIndex}`}
          item={editing.item}
          onCancel={() => setEditing(null)}
          onOk={(next) => {
            if (editing.area === "grid") upsertItemInActiveTab(next);
            else upsertTopBarItem(next);
            setEditing(null);
          }}
          onDelete={() => {
            if (editing.area === "grid") removeItemInActiveTab(editing.item.key);
            else removeTopBarItem(editing.item.key);
            setEditing(null);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** 单个格子 */
function Cell({
  hotkey,
  item,
  onClick,
  onContextMenu,
  onDrop,
  onDragStart,
}: {
  hotkey: string;
  item?: LaunchItem;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const empty = !item;
  const iconUrl = useItemIcon(item);
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        e.preventDefault();
        const isInternal = e.dataTransfer.types.includes(
          "application/x-ql-move"
        );
        e.dataTransfer.dropEffect = isInternal ? "move" : "copy";
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        onDrop(e);
      }}
      draggable={!empty}
      onDragStart={(e) => {
        setDragging(true);
        onDragStart(e);
      }}
      onDragEnd={() => setDragging(false)}
      className={`cell ${empty ? "empty" : "filled"} ${
        dragOver ? "drop-target" : ""
      } ${dragging ? "dragging" : ""} relative flex flex-col items-center justify-center gap-[2px] min-h-[44px] px-1 py-1 overflow-hidden`}
      title={
        empty
          ? `${hotkey} · 左键添加 / 拖入文件 / 右键菜单`
          : `${hotkey} · ${item!.name}\n${item!.target}\n左键启动 · 右键菜单 · 拖拽移动`
      }
    >
      {/* hotkey 标签：更淡、更小、更边缘 */}
      <span
        className={`absolute top-0.5 left-1 text-[9px] font-medium leading-none pointer-events-none ${
          empty ? "text-white/20" : "text-white/50"
        }`}
      >
        {hotkey}
      </span>

      {/* 图标：响应式大小 */}
      {empty ? (
        <span className="text-white/15 text-lg leading-none transition-colors group-hover:text-white/40">
          +
        </span>
      ) : iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className="object-contain drop-shadow shrink-0"
          style={{ width: "min(28px, 55%)", height: "min(28px, 55%)" }}
          draggable={false}
        />
      ) : (
        <span
          className="flex items-center justify-center text-[11px] font-semibold text-white/90 tracking-tight"
          style={{ width: "min(28px, 55%)", height: "min(28px, 55%)" }}
        >
          {initialsOf(item!.name || item!.target)}
        </span>
      )}

      {/* 名称：紧贴图标下方 */}
      <span
        className={`text-[11px] truncate max-w-full leading-tight ${
          empty ? "text-white/30" : "text-white/90"
        }`}
      >
        {empty ? "" : item!.name || item!.target}
      </span>
    </div>
  );
}

/** 取显示名的首字母缩略（URL 类目标用） */
function initialsOf(s: string): string {
  // 从 URL 拿 host 首段
  const m = s.match(/^https?:\/\/(?:www\.)?([^\/?#]+)/i);
  if (m) return m[1].split(".")[0].slice(0, 2).toUpperCase();
  // 正常名称取前 2 个字符
  return s.trim().slice(0, 2).toUpperCase();
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const sep = trimmed.lastIndexOf("\\") !== -1 ? "\\" : "/";
  const last = trimmed.split(sep).pop() || trimmed;
  return last.replace(/\.[^.]+$/, "");
}

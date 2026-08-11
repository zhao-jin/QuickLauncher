import { create } from "zustand";
import type { AppConfig, LaunchItem, Tab } from "@/types/config";
import {
  loadConfigRaw,
  resolvePathRoots,
  saveConfigRaw,
  setPathRootsBackend,
} from "@/lib/ipc";
import { initPathBase, setPathRoots } from "@/lib/pathUtil";

/**
 * 同步命名根目录：先把 config 里的表推给后端，再拉回实际生效值
 * （`QL_<NAME>` 环境变量会覆盖 config），让前端显示与启动行为一致。
 */
async function syncRoots(roots: Record<string, string> | undefined) {
  setPathRoots(roots);
  try {
    await setPathRootsBackend(roots ?? {});
    const resolved = await resolvePathRoots();
    const effective: Record<string, string> = {};
    for (const item of resolved) {
      if (item.value) effective[item.name] = item.value;
    }
    setPathRoots(effective);
  } catch (e) {
    console.error("sync path roots failed", e);
  }
}

/** 默认示例配置 */
function makeDefaultConfig(): AppConfig {
  const demoRED: Tab = {
    id: "tab-red",
    name: "示例",
    items: [
      mk("Q", "记事本", "notepad.exe"),
      mk("W", "计算器", "calc.exe"),
      mk("E", "画图", "mspaint.exe"),
      mk("R", "cmd", "cmd.exe"),
      mk("A", "任务管理器", "taskmgr.exe"),
      mk("S", "百度", "https://www.baidu.com"),
      mk("D", "C盘", "C:\\"),
    ],
  };
  return {
    version: 1,
    hotkey: "Ctrl+`",
    layout: { cols: 10, rows: 3 },
    appearance: { theme: "darkAcrylic", opacity: 0.98, iconSize: 32 },
    behavior: {
      hideOnFocusLost: true,
      hideAfterLaunch: true,
      autoStart: false,
    },
    roots: {},
    topBar: [mkF("F1", "Explorer", "explorer.exe")],
    tabs: [demoRED, { id: "tab-tools", name: "Tools", items: [] }],
  };
}

function mk(key: string, name: string, target: string): LaunchItem {
  return {
    key,
    name,
    target,
    arguments: "",
    startIn: "",
    run: "normal",
    runAsAdmin: false,
    iconMode: "default",
    iconPath: "",
    iconIndex: 0,
  };
}
function mkF(key: string, name: string, target: string): LaunchItem {
  return mk(key, name, target);
}

interface ConfigStore {
  config: AppConfig;
  activeTabIndex: number;
  loaded: boolean;

  /** 启动时调用：从 config.json 加载；不存在则用默认配置并立即写入 */
  loadFromDisk: () => Promise<void>;

  setActiveTab: (i: number) => void;

  /** 所有修改 item 的入口，会同步调度持久化 */
  upsertItemInActiveTab: (item: LaunchItem) => void;
  removeItemInActiveTab: (key: string) => void;
  upsertTopBarItem: (item: LaunchItem) => void;
  removeTopBarItem: (key: string) => void;
  /** 内部拖拽：把 from 的 item 搬到 to；若 to 已有 item，则交换 */
  moveItem: (
    from: { area: "grid" | "top"; key: string },
    to: { area: "grid" | "top"; key: string }
  ) => void;
  addTab: (name: string) => void;
  renameTab: (i: number, name: string) => void;
  removeTab: (i: number) => void;
  updateLayout: (cols: number, rows: number) => void;
  /** 整体替换配置（SettingsDialog Apply 用） */
  updateSettings: (next: AppConfig) => void;

  getActiveItemByKey: (key: string) => LaunchItem | undefined;
  getTopBarItemByKey: (key: string) => LaunchItem | undefined;
}

let saveTimer: number | null = null;
/** 防抖保存：连续修改 500ms 后落盘一次 */
function scheduleSave(get: () => ConfigStore) {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const cfg = get().config;
    const content = JSON.stringify(cfg, null, 2);
    saveConfigRaw(content).catch((e) => console.error("save config failed", e));
  }, 500) as unknown as number;
}

/** 把变更封装成带持久化的 setter */
function withSave<T>(
  set: (fn: (s: ConfigStore) => Partial<ConfigStore>) => void,
  get: () => ConfigStore,
  fn: (s: ConfigStore) => Partial<ConfigStore>
) {
  set(fn);
  scheduleSave(get);
  return undefined as unknown as T;
}

export const useConfig = create<ConfigStore>((set, get) => ({
  config: makeDefaultConfig(),
  activeTabIndex: 0,
  loaded: false,

  loadFromDisk: async () => {
    // 先拿到 portable 目录，之后相对路径才能同步解析成绝对路径
    await initPathBase();
    try {
      const raw = await loadConfigRaw();
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw) as AppConfig;
        // 简单兼容：缺字段用默认值补齐
        const def = makeDefaultConfig();
        const merged: AppConfig = {
          version: parsed.version ?? def.version,
          hotkey: parsed.hotkey ?? def.hotkey,
          layout: { ...def.layout, ...(parsed.layout ?? {}) },
          appearance: { ...def.appearance, ...(parsed.appearance ?? {}) },
          behavior: { ...def.behavior, ...(parsed.behavior ?? {}) },
          roots: parsed.roots ?? def.roots,
          topBar: parsed.topBar ?? def.topBar,
          tabs: parsed.tabs ?? def.tabs,
        };
        // 等变量解析完再渲染，否则首帧显示的绝对路径可能不对
        await syncRoots(merged.roots);
        set({ config: merged, loaded: true });
      } else {
        // 不存在 → 用默认并立即写入
        const def = makeDefaultConfig();
        await syncRoots(def.roots);
        set({ config: def, loaded: true });
        await saveConfigRaw(JSON.stringify(def, null, 2)).catch((e) =>
          console.error("first save failed", e)
        );
      }
    } catch (e) {
      console.error("loadConfig failed, fallback to default", e);
      const def = makeDefaultConfig();
      syncRoots(def.roots);
      set({ config: def, loaded: true });
    }
  },

  setActiveTab: (i) => set({ activeTabIndex: i }),

  upsertItemInActiveTab: (item) =>
    withSave(set, get, (s) => {
      const tabs = s.config.tabs.map((t, i) => {
        if (i !== s.activeTabIndex) return t;
        const items = t.items.filter((x) => x.key !== item.key).concat(item);
        return { ...t, items };
      });
      return { config: { ...s.config, tabs } };
    }),

  removeItemInActiveTab: (key) =>
    withSave(set, get, (s) => {
      const tabs = s.config.tabs.map((t, i) => {
        if (i !== s.activeTabIndex) return t;
        return { ...t, items: t.items.filter((x) => x.key !== key) };
      });
      return { config: { ...s.config, tabs } };
    }),

  upsertTopBarItem: (item) =>
    withSave(set, get, (s) => ({
      config: {
        ...s.config,
        topBar: s.config.topBar.filter((x) => x.key !== item.key).concat(item),
      },
    })),

  removeTopBarItem: (key) =>
    withSave(set, get, (s) => ({
      config: {
        ...s.config,
        topBar: s.config.topBar.filter((x) => x.key !== key),
      },
    })),

  moveItem: (from, to) =>
    withSave(set, get, (s) => {
      if (from.area === to.area && from.key === to.key) return {};

      // 取出源 / 目标 item（不可变视图）
      const getFromGrid = (key: string) =>
        s.config.tabs[s.activeTabIndex]?.items.find((x) => x.key === key);
      const getFromTop = (key: string) =>
        s.config.topBar.find((x) => x.key === key);
      const src =
        from.area === "grid" ? getFromGrid(from.key) : getFromTop(from.key);
      if (!src) return {}; // 没源什么都不做

      const dst =
        to.area === "grid" ? getFromGrid(to.key) : getFromTop(to.key);

      // 新 src（落到目标格）和 新 dst（回落到源格，仅当存在 dst 时）
      const newAtTo: LaunchItem = { ...src, key: to.key };
      const newAtFrom: LaunchItem | null = dst
        ? { ...dst, key: from.key }
        : null;

      // 先构造新的 grid tabs
      let newTabs = s.config.tabs;
      let newTopBar = s.config.topBar;

      const mutateGrid = (
        items: LaunchItem[],
        removeKey: string | null,
        addItem: LaunchItem | null
      ): LaunchItem[] => {
        let next = items;
        if (removeKey) next = next.filter((x) => x.key !== removeKey);
        if (addItem) {
          next = next.filter((x) => x.key !== addItem.key).concat(addItem);
        }
        return next;
      };

      // 从 from 区域移除 src（稍后 addItem=newAtFrom 或留空）
      if (from.area === "grid") {
        newTabs = newTabs.map((t, i) =>
          i === s.activeTabIndex
            ? { ...t, items: mutateGrid(t.items, from.key, null) }
            : t
        );
      } else {
        newTopBar = mutateGrid(newTopBar, from.key, null);
      }

      // 从 to 区域移除 dst（若存在）并放入 newAtTo
      if (to.area === "grid") {
        newTabs = newTabs.map((t, i) =>
          i === s.activeTabIndex
            ? { ...t, items: mutateGrid(t.items, to.key, newAtTo) }
            : t
        );
      } else {
        newTopBar = mutateGrid(newTopBar, to.key, newAtTo);
      }

      // 若 dst 存在，把 dst 放到 from 位置（完成交换）
      if (newAtFrom) {
        if (from.area === "grid") {
          newTabs = newTabs.map((t, i) =>
            i === s.activeTabIndex
              ? { ...t, items: mutateGrid(t.items, null, newAtFrom) }
              : t
          );
        } else {
          newTopBar = mutateGrid(newTopBar, null, newAtFrom);
        }
      }

      return {
        config: { ...s.config, tabs: newTabs, topBar: newTopBar },
      };
    }),


  addTab: (name) =>
    withSave(set, get, (s) => ({
      config: {
        ...s.config,
        tabs: [
          ...s.config.tabs,
          { id: `tab-${Date.now()}`, name, items: [] },
        ],
      },
    })),

  renameTab: (i, name) =>
    withSave(set, get, (s) => ({
      config: {
        ...s.config,
        tabs: s.config.tabs.map((t, idx) => (idx === i ? { ...t, name } : t)),
      },
    })),

  removeTab: (i) =>
    withSave(set, get, (s) => {
      const tabs = s.config.tabs.filter((_, idx) => idx !== i);
      const nextIdx = Math.min(s.activeTabIndex, tabs.length - 1);
      return {
        config: { ...s.config, tabs },
        activeTabIndex: Math.max(0, nextIdx),
      };
    }),

  updateLayout: (cols, rows) =>
    withSave(set, get, (s) => ({
      config: {
        ...s.config,
        layout: { cols, rows },
      },
    })),

  updateSettings: (next) =>
    withSave(set, get, () => {
      syncRoots(next.roots);
      return { config: next };
    }),

  getActiveItemByKey: (key) => {
    const s = get();
    return s.config.tabs[s.activeTabIndex]?.items.find((x) => x.key === key);
  },

  getTopBarItemByKey: (key) => {
    const s = get();
    return s.config.topBar.find((x) => x.key === key);
  },
}));

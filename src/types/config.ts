/** 与后端 Rust struct 对齐的启动项（后端实际只用 target/arguments/startIn/run/runAsAdmin） */
export type RunMode = "normal" | "minimized" | "maximized" | "hidden";

/** 图标来源 */
export type IconMode =
  | "default"   // 由 target 自动派生（Shell 默认图标）
  | "custom"    // 用户提供的图片文件（png/ico/jpg）
  | "resource"; // 来自 PE 资源（.dll/.exe + iconIndex）

/** 外观属性（M2 先保留字段，UI 预留，M4 完全生效） */
export interface Appearance {
  fontColor?: string;
  backgroundColor?: string;
  fontBold?: boolean;
  fontSize?: number;
}

/** 单个启动项（完整属性，参考 MadAppLauncher） */
export interface LaunchItem {
  /** 绑定的键位（如 "Q"、"F1"），不参与 Rust 结构，仅前端使用 */
  key: string;
  /** 显示名称 */
  name: string;
  /** 目标 */
  target: string;
  /** 启动参数 */
  arguments: string;
  /** 工作目录 */
  startIn: string;
  /** 运行窗口模式 */
  run: RunMode;
  /** 以管理员身份运行 */
  runAsAdmin: boolean;
  /** 图标模式 */
  iconMode: IconMode;
  /** 自定义图标路径（iconMode=custom 时生效） */
  iconPath: string;
  /** exe/dll 内图标索引 */
  iconIndex: number;
  /** 外观 */
  appearance?: Appearance;
}

/** Tab */
export interface Tab {
  id: string;
  name: string;
  items: LaunchItem[];
}

/** 布局 */
export interface Layout {
  cols: number; // 默认 10
  rows: number; // 默认 3
}

/** 行为 */
export interface Behavior {
  hideOnFocusLost: boolean;
  hideAfterLaunch: boolean;
  autoStart: boolean;
}

/** 外观总设置 */
export interface AppearanceConfig {
  theme: "darkAcrylic" | "dark";
  opacity: number;
  iconSize: number;
}

/** 整份配置 */
export interface AppConfig {
  version: number;
  hotkey: string;
  layout: Layout;
  appearance: AppearanceConfig;
  behavior: Behavior;
  topBar: LaunchItem[];
  tabs: Tab[];
}

/** 新建一个空白 LaunchItem（给指定键位） */
export function emptyItem(key: string): LaunchItem {
  return {
    key,
    name: "",
    target: "",
    arguments: "",
    startIn: "",
    run: "normal",
    runAsAdmin: false,
    iconMode: "default",
    iconPath: "",
    iconIndex: 0,
  };
}

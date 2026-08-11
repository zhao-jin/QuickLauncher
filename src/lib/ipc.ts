import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { LaunchItem } from "@/types/config";

/** 调用后端启动一个命令项 */
export async function launchItem(item: LaunchItem): Promise<void> {
  await invoke("launch_item", {
    item: {
      name: item.name,
      target: item.target,
      arguments: item.arguments,
      startIn: item.startIn,
      run: item.run,
      runAsAdmin: item.runAsAdmin,
    },
  });
}

/** 在资源管理器中定位到该 target（文件用 /select 高亮，目录直接打开，URL 报错） */
export async function revealInExplorer(target: string): Promise<void> {
  await invoke("reveal_in_explorer", { target });
}

/** 加载配置 JSON 字符串（空串表示不存在，前端用默认配置并触发首次写入） */
export async function loadConfigRaw(): Promise<string> {
  return await invoke<string>("load_config");
}

/** 保存配置 JSON 字符串 */
export async function saveConfigRaw(content: string): Promise<void> {
  await invoke("save_config", { content });
}

/** 获取 portable 目录（用于调试展示） */
export async function getPortableDir(): Promise<string> {
  return await invoke<string>("portable_dir_path");
}

/** 把命名根目录表同步给后端（启动项路径里的 ${NAME} 由后端展开） */
export async function setPathRootsBackend(
  roots: Record<string, string>
): Promise<void> {
  await invoke("set_path_roots", { roots });
}

/**
 * 变量取值来源。环境变量优先于 config，因为这些根目录通常是机器上预设一次、
 * 与其他工具共用的；config.roots 只是自带默认值。
 */
export type VarSource = "envprefixed" | "env" | "config";

export interface ResolvedVar {
  name: string;
  value: string;
  source: VarSource;
  /** 被环境变量遮蔽时，这里是 config 里原本的值 */
  overriddenValue: string | null;
  exists: boolean;
}

/** 查询每个变量当前实际生效的值与来源 */
export async function resolvePathRoots(): Promise<ResolvedVar[]> {
  return await invoke<ResolvedVar[]>("resolve_path_roots");
}

/** 彻底退出进程（绕过 CloseRequested 的 hide 拦截） */
export async function quitApp(): Promise<void> {
  await invoke("quit_app");
}

/** 提取图标，返回 PNG 本地路径；前端需 convertFileSrc 转成 asset:// URL */
export async function extractIcon(
  target: string,
  iconIndex = 0
): Promise<string | null> {
  if (!target) return null;
  try {
    const p = await invoke<string>("extract_icon_to_png", {
      target,
      iconIndex,
    });
    return convertFileSrc(p);
  } catch (e) {
    console.warn("extractIcon failed:", e);
    return null;
  }
}

/** 列出 .dll/.exe 中含有的图标总数 */
export async function enumerateResourceIcons(file: string): Promise<number> {
  return await invoke<number>("enumerate_resource_icons", { file });
}

/** 批量提取 .dll/.exe 中 [start..start+count) 的图标，返回 [(index, asset url), ...] */
export async function extractResourceIconsRange(
  file: string,
  start: number,
  count: number
): Promise<Array<{ index: number; url: string }>> {
  const res = await invoke<Array<[number, string]>>(
    "extract_resource_icons_range",
    { file, start, count }
  );
  return res.map(([index, path]) => ({ index, url: convertFileSrc(path) }));
}

/** 系统文件选择器 */
export async function pickExeFile(): Promise<string | null> {
  const res = await openDialog({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Executable / Script / Link",
        extensions: ["exe", "bat", "cmd", "ps1", "lnk", "msi"],
      },
      { name: "All files", extensions: ["*"] },
    ],
  });
  return typeof res === "string" ? res : null;
}

/** 系统文件夹选择器 */
export async function pickFolder(): Promise<string | null> {
  const res = await openDialog({ multiple: false, directory: true });
  return typeof res === "string" ? res : null;
}

/** 单独选图标（png/ico/jpg） */
export async function pickIcon(): Promise<string | null> {
  const res = await openDialog({
    multiple: false,
    directory: false,
    filters: [
      { name: "Icon", extensions: ["ico", "png", "jpg", "jpeg", "bmp"] },
    ],
  });
  return typeof res === "string" ? res : null;
}

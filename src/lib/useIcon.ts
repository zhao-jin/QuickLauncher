import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { extractIcon } from "@/lib/ipc";
import type { LaunchItem } from "@/types/config";

/** 已解析过的 icon URL 缓存 */
const cache = new Map<string, string | null>();

function cacheKeyOf(item: LaunchItem): string {
  if (item.iconMode === "custom" && item.iconPath) {
    return `custom:${item.iconPath}`;
  }
  if (item.iconMode === "resource" && item.iconPath) {
    return `res:${item.iconPath}#${item.iconIndex || 0}`;
  }
  return `auto:${item.target}#${item.iconIndex || 0}`;
}

/**
 * 根据 item 异步拿到最终图标 URL（asset:// 协议）。
 * - custom 模式：用 convertFileSrc 把用户指定的本地图片转 URL
 * - resource 模式：从 .dll/.exe 中提取指定 index 的图标
 * - default 模式：基于 target 自动取 Shell 图标
 * - URL / target 为空时返回 null
 */
export function useItemIcon(item: LaunchItem | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!item) return null;
    const k = cacheKeyOf(item);
    return cache.has(k) ? cache.get(k)! : null;
  });

  useEffect(() => {
    if (!item) {
      setUrl(null);
      return;
    }
    const k = cacheKeyOf(item);
    if (cache.has(k)) {
      setUrl(cache.get(k)!);
      return;
    }

    let cancelled = false;

    const resolve = async () => {
      // custom：直接转 file URL
      if (item.iconMode === "custom" && item.iconPath) {
        const u = convertFileSrc(item.iconPath);
        cache.set(k, u);
        if (!cancelled) setUrl(u);
        return;
      }
      // resource：调后端从 dll/exe 提取
      if (item.iconMode === "resource" && item.iconPath) {
        const u = await extractIcon(item.iconPath, item.iconIndex || 0);
        cache.set(k, u);
        if (!cancelled) setUrl(u);
        return;
      }
      // default：URL 不提图标
      if (!item.target || /^https?:\/\//i.test(item.target)) {
        cache.set(k, null);
        if (!cancelled) setUrl(null);
        return;
      }
      const u = await extractIcon(item.target, item.iconIndex || 0);
      cache.set(k, u);
      if (!cancelled) setUrl(u);
    };
    resolve();

    return () => {
      cancelled = true;
    };
  }, [item && cacheKeyOf(item)]); // eslint-disable-line react-hooks/exhaustive-deps

  return url;
}

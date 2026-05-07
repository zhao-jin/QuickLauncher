//! 图标提取与缓存模块。
//!
//! 三种来源：
//!   1. 普通文件（target=exe/bat/lnk/folder）→ `SHGetFileInfoW` 取 Shell 默认图标
//!   2. PE 资源指定 index（target=shell32.dll, index=137）→ `ExtractIconExW`
//!   3. 用户自定义图标文件（png/ico/jpg）→ 前端直接 convertFileSrc，不走这里
//!
//! 缓存路径：`<portable_dir>/icons/<sha1(source#index)>.png`
//!
//! 同时暴露 `enumerate_resource_icons(file)` 供"图标选择器"前端列出 .dll/.exe 里所有图标。

use crate::config_store::icons_dir;
use sha1::{Digest, Sha1};
use std::fs;

/// 计算缓存文件名（10 字节 hex 已足够）
fn cache_hash(s: &str) -> String {
    let mut h = Sha1::new();
    h.update(s.as_bytes());
    let bytes = h.finalize();
    bytes[..10].iter().map(|b| format!("{b:02x}")).collect::<String>()
}

/// 入参 source 是否像一个"PE 资源容器"（dll/exe/icl/ocx）。
fn is_resource_container(source: &str) -> bool {
    let lower = source.to_lowercase();
    lower.ends_with(".dll")
        || lower.ends_with(".exe")
        || lower.ends_with(".icl")
        || lower.ends_with(".ocx")
        || lower.ends_with(".cpl")
        || lower.ends_with(".mui")
}

/// 提取图标到 PNG，返回输出路径。
///
/// - source 是 dll/exe/... 且 icon_index >= 0：用 `ExtractIconExW` 从资源里取
/// - 否则：用 `SHGetFileInfoW` 取 Shell 默认图标（icon_index 被忽略）
#[tauri::command]
pub fn extract_icon_to_png(target: String, icon_index: i32) -> Result<String, String> {
    // URL 不提图标，直接报错
    if target.starts_with("http://") || target.starts_with("https://") {
        return Err("icon not available for URL".into());
    }

    let cache_key = format!("{target}#{icon_index}");
    let hash = cache_hash(&cache_key);

    let dir = icons_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir icons failed: {e}"))?;
    let out = dir.join(format!("{hash}.png"));

    if !out.exists() {
        #[cfg(windows)]
        {
            if is_resource_container(&target) && icon_index >= 0 {
                win_extract::extract_resource(&target, icon_index, &out)?;
            } else {
                win_extract::extract_shell(&target, &out)?;
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (target.as_str(), icon_index);
            return Err("icon extraction only on Windows".into());
        }
    }

    Ok(out.to_string_lossy().to_string())
}

/// 列出 .dll/.exe 中含有的图标数量。
/// 返回 `count`（图标总数，可索引 0..count-1）。
#[tauri::command]
pub fn enumerate_resource_icons(file: String) -> Result<i32, String> {
    #[cfg(windows)]
    {
        if !is_resource_container(&file) {
            return Err(format!("不是 PE 资源容器（应为 .dll/.exe/.icl）: {file}"));
        }
        win_extract::count_icons(&file)
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        Err("only on Windows".into())
    }
}

/// 批量提取 .dll/.exe 中第 [start..start+count) 个图标到 PNG 列表。
/// 返回每个 index 对应的 PNG 文件路径（前端用 convertFileSrc 显示）。
#[tauri::command]
pub fn extract_resource_icons_range(
    file: String,
    start: i32,
    count: i32,
) -> Result<Vec<(i32, String)>, String> {
    let mut out = Vec::with_capacity(count.max(0) as usize);
    for i in 0..count {
        let idx = start + i;
        match extract_icon_to_png(file.clone(), idx) {
            Ok(path) => out.push((idx, path)),
            Err(_) => {
                // 单个失败不影响整体，跳过
            }
        }
    }
    Ok(out)
}

#[cfg(windows)]
mod win_extract {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, SelectObject,
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows_sys::Win32::UI::Shell::{
        ExtractIconExW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
        SHGFI_USEFILEATTRIBUTES,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, GetIconInfo, HICON, ICONINFO,
    };
    // FILE_ATTRIBUTE_NORMAL = 0x80

    pub(super) fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// 把 HBITMAP(彩色 + 掩码) 组合成 RGBA 像素
    unsafe fn hbitmap_to_rgba(hbm: HBITMAP, mask: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
        if hbm.is_null() {
            return None;
        }
        let mut bm: BITMAP = std::mem::zeroed();
        let r = GetObjectW(
            hbm as HGDIOBJ,
            std::mem::size_of::<BITMAP>() as i32,
            &mut bm as *mut _ as *mut _,
        );
        if r == 0 {
            return None;
        }
        let w = bm.bmWidth as u32;
        let h = bm.bmHeight.unsigned_abs();
        if w == 0 || h == 0 {
            return None;
        }

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w as i32;
        bmi.bmiHeader.biHeight = -(h as i32);
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let mut buf = vec![0u8; (w * h * 4) as usize];
        let dc = CreateCompatibleDC(std::ptr::null_mut());
        if dc.is_null() {
            return None;
        }
        let old = SelectObject(dc, hbm as HGDIOBJ);
        let got = GetDIBits(
            dc, hbm, 0, h, buf.as_mut_ptr() as *mut _, &mut bmi, DIB_RGB_COLORS,
        );
        SelectObject(dc, old);
        DeleteDC(dc);
        if got == 0 {
            return None;
        }

        // 用 mask 重建 alpha（如必要）
        let has_alpha = buf.chunks(4).any(|p| p[3] != 0);
        if !has_alpha && !mask.is_null() {
            let mut mbm: BITMAP = std::mem::zeroed();
            if GetObjectW(
                mask as HGDIOBJ,
                std::mem::size_of::<BITMAP>() as i32,
                &mut mbm as *mut _ as *mut _,
            ) != 0
            {
                let mw = mbm.bmWidth as u32;
                let mh = mbm.bmHeight.unsigned_abs();
                if mw == w && mh == h {
                    let mut mbi: BITMAPINFO = std::mem::zeroed();
                    mbi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
                    mbi.bmiHeader.biWidth = mw as i32;
                    mbi.bmiHeader.biHeight = -(mh as i32);
                    mbi.bmiHeader.biPlanes = 1;
                    mbi.bmiHeader.biBitCount = 32;
                    mbi.bmiHeader.biCompression = BI_RGB;

                    let mut mbuf = vec![0u8; (mw * mh * 4) as usize];
                    let dc2 = CreateCompatibleDC(std::ptr::null_mut());
                    if !dc2.is_null() {
                        let old2 = SelectObject(dc2, mask as HGDIOBJ);
                        GetDIBits(
                            dc2,
                            mask,
                            0,
                            mh,
                            mbuf.as_mut_ptr() as *mut _,
                            &mut mbi,
                            DIB_RGB_COLORS,
                        );
                        SelectObject(dc2, old2);
                        DeleteDC(dc2);

                        for (i, px) in buf.chunks_mut(4).enumerate() {
                            let mpx = &mbuf[i * 4..i * 4 + 3];
                            let transparent = mpx[0] > 128 && mpx[1] > 128 && mpx[2] > 128;
                            px[3] = if transparent { 0 } else { 255 };
                        }
                    }
                }
            }
        }

        // BGRA -> RGBA
        for px in buf.chunks_mut(4) {
            px.swap(0, 2);
        }

        Some((w, h, buf))
    }

    /// 把 HICON 保存为 PNG
    unsafe fn save_hicon_to_png(hicon: HICON, out_path: &Path) -> Result<(), String> {
        if hicon.is_null() {
            return Err("HICON is null".into());
        }
        let mut ii: ICONINFO = std::mem::zeroed();
        let ok = GetIconInfo(hicon, &mut ii);
        if ok == 0 {
            return Err("GetIconInfo failed".into());
        }

        let rgba = hbitmap_to_rgba(ii.hbmColor, ii.hbmMask);
        if !ii.hbmColor.is_null() {
            DeleteObject(ii.hbmColor as HGDIOBJ);
        }
        if !ii.hbmMask.is_null() {
            DeleteObject(ii.hbmMask as HGDIOBJ);
        }

        let (w, h, pixels) = rgba.ok_or_else(|| "hbitmap_to_rgba failed".to_string())?;
        let img: image::RgbaImage =
            image::ImageBuffer::from_raw(w, h, pixels).ok_or("build RgbaImage failed")?;
        img.save(out_path).map_err(|e| format!("save png failed: {e}"))?;
        Ok(())
    }

    /// 用 ExtractIconExW 从 PE 文件取指定 index 的大图标
    pub fn extract_resource(file: &str, index: i32, out_path: &Path) -> Result<(), String> {
        let wpath = to_wide(file);
        unsafe {
            let mut hlarge: HICON = std::ptr::null_mut();
            let n = ExtractIconExW(wpath.as_ptr(), index, &mut hlarge, std::ptr::null_mut(), 1);
            if n == 0 || hlarge.is_null() {
                return Err(format!(
                    "ExtractIconExW returned no icon: file={file} index={index}"
                ));
            }
            let res = save_hicon_to_png(hlarge, out_path);
            DestroyIcon(hlarge);
            res
        }
    }

    /// 用 SHGetFileInfoW 取 Shell 默认图标
    pub fn extract_shell(target: &str, out_path: &Path) -> Result<(), String> {
        const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;

        let path = Path::new(target);
        let wpath = to_wide(target);

        unsafe {
            let mut info: SHFILEINFOW = std::mem::zeroed();
            let flags = SHGFI_ICON
                | SHGFI_LARGEICON
                | if path.exists() { 0 } else { SHGFI_USEFILEATTRIBUTES };
            let ret = SHGetFileInfoW(
                wpath.as_ptr(),
                FILE_ATTRIBUTE_NORMAL,
                &mut info,
                std::mem::size_of::<SHFILEINFOW>() as u32,
                flags,
            );
            if ret == 0 || info.hIcon.is_null() {
                return Err(format!("SHGetFileInfoW returned no icon for {target}"));
            }
            let res = save_hicon_to_png(info.hIcon, out_path);
            DestroyIcon(info.hIcon);
            res
        }
    }

    /// 计算 .dll/.exe 中含有的图标总数
    pub fn count_icons(file: &str) -> Result<i32, String> {
        let wpath = to_wide(file);
        unsafe {
            // 第二个参数 -1 表示"返回图标总数"
            let n = ExtractIconExW(
                wpath.as_ptr(),
                -1,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                0,
            );
            // ExtractIconExW 返回 u32，约定 0xFFFFFFFF/0 表示出错
            if n == 0 || n == u32::MAX {
                return Err(format!("ExtractIconExW count failed for {file}"));
            }
            Ok(n as i32)
        }
    }
}

#[cfg(not(windows))]
mod win_extract {
    use std::path::Path;
    pub fn extract_resource(_f: &str, _i: i32, _o: &Path) -> Result<(), String> {
        Err("not windows".into())
    }
    pub fn extract_shell(_t: &str, _o: &Path) -> Result<(), String> {
        Err("not windows".into())
    }
    pub fn count_icons(_f: &str) -> Result<i32, String> {
        Err("not windows".into())
    }
}

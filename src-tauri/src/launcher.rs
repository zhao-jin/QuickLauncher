//! 命令执行模块。
//!
//! 使用 Windows `ShellExecuteExW` 作为统一入口，一把搞定：
//!   - exe / bat / cmd / ps1 / lnk / 任意关联文件
//!   - http/https URL（走默认浏览器）
//!   - 文件夹路径（走资源管理器）
//!   - 管理员权限（verb = "runas"）
//!   - 四种窗口模式：normal / minimized / maximized / hidden

use serde::{Deserialize, Serialize};

/// 前端传入的启动项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchItem {
    /// 显示名称（仅日志用）
    #[serde(default)]
    pub name: String,
    /// 目标：exe/bat/ps1 路径、URL、文件夹等
    pub target: String,
    /// 启动参数
    #[serde(default)]
    pub arguments: String,
    /// 工作目录
    #[serde(default, rename = "startIn")]
    pub start_in: String,
    /// 运行窗口模式
    #[serde(default)]
    pub run: RunMode,
    /// 以管理员身份运行（触发 UAC 弹窗）
    #[serde(default, rename = "runAsAdmin")]
    pub run_as_admin: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RunMode {
    #[default]
    Normal,
    Minimized,
    Maximized,
    Hidden,
}

#[cfg(windows)]
mod win {
    use super::{LaunchItem, RunMode};
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SW_HIDE, SW_SHOWMAXIMIZED, SW_SHOWMINNOACTIVE, SW_SHOWNORMAL,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn show_cmd(mode: RunMode) -> i32 {
        (match mode {
            RunMode::Normal => SW_SHOWNORMAL,
            RunMode::Minimized => SW_SHOWMINNOACTIVE,
            RunMode::Maximized => SW_SHOWMAXIMIZED,
            RunMode::Hidden => SW_HIDE,
        }) as i32
    }

    /// 当 target 是 URL 时直接返回；否则返回绝对路径字符串
    fn normalize_target(target: &str) -> String {
        let t = target.trim();
        if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("file://") {
            return t.to_string();
        }
        let p = Path::new(t);
        if p.is_absolute() {
            // 绝对路径直接用
            return t.to_string();
        }
        // 裸命令（如 "python" / "python3" / "explorer"）——保持不变，
        // 让 ShellExecuteExW 去 PATH 里查。若用 current_dir 拼绝对路径反而会
        // 变成 "<cwd>\python" 这种不存在的文件。
        if !t.contains(std::path::MAIN_SEPARATOR) && !t.contains('/') {
            return t.to_string();
        }
        // 相对路径（含路径分隔符）→ 相对 cwd 拼绝对
        std::env::current_dir()
            .map(|d| d.join(p))
            .unwrap_or_else(|_| p.to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    /// 推断 "Start in"：未指定时取 target 父目录（对 URL 不生效）；
    /// 若指定的目录实际不存在（例如 miles 的旧配置里 I:\RED\mtool），
    /// 返回空串，让 Shell 自己决定（避免 ShellExecuteExW 因 workdir 无效直接失败）。
    fn infer_workdir(item: &LaunchItem, target: &str) -> String {
        if !item.start_in.trim().is_empty() {
            let p = Path::new(item.start_in.trim());
            if p.is_dir() {
                return item.start_in.clone();
            }
            // 指定了但不存在 → 忽略
            return String::new();
        }
        if target.starts_with("http://") || target.starts_with("https://") {
            return String::new();
        }
        // 裸命令，不尝试父目录
        if !target.contains(std::path::MAIN_SEPARATOR) && !target.contains('/') {
            return String::new();
        }
        Path::new(target)
            .parent()
            .filter(|p| p.is_dir())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    }

    pub fn execute(item: &LaunchItem) -> Result<(), String> {
        let target = normalize_target(&item.target);
        let workdir = infer_workdir(item, &target);

        let file_w = to_wide(&target);
        let params_w = to_wide(&item.arguments);
        let dir_w = to_wide(&workdir);
        let verb_w = to_wide("runas");

        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        info.lpVerb = if item.run_as_admin {
            verb_w.as_ptr()
        } else {
            std::ptr::null()
        };
        info.lpFile = file_w.as_ptr();
        info.lpParameters = if item.arguments.is_empty() {
            std::ptr::null()
        } else {
            params_w.as_ptr()
        };
        info.lpDirectory = if workdir.is_empty() {
            std::ptr::null()
        } else {
            dir_w.as_ptr()
        };
        info.nShow = show_cmd(item.run);

        // SAFETY: 所有指针要么为 null，要么指向以 0 结尾的 UTF-16 字符串
        let ok = unsafe { ShellExecuteExW(&mut info) };
        if ok == 0 {
            let err = std::io::Error::last_os_error();
            return Err(format!(
                "启动失败: {err}\n  target = {target}\n  args = {args}\n  workdir = {workdir}",
                target = target,
                args = item.arguments,
                workdir = if workdir.is_empty() { "<默认>".to_string() } else { workdir.clone() }
            ));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod win {
    use super::LaunchItem;
    pub fn execute(_item: &LaunchItem) -> Result<(), String> {
        Err("Only Windows is supported".into())
    }
}

/// Tauri command：启动一个命令项
#[tauri::command]
pub fn launch_item(item: LaunchItem) -> Result<(), String> {
    eprintln!(
        "[launch] name={:?} target={:?} args={:?} workdir={:?} run={:?} admin={}",
        item.name, item.target, item.arguments, item.start_in, item.run, item.run_as_admin
    );
    win::execute(&item)
}

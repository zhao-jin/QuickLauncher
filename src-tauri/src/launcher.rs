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

    /// URL → 原样；绝对路径 → 原样；裸命令名（无分隔符）→ 原样交 Shell 查 PATH；
    /// 相对路径（含分隔符）→ 按 portable 目录拼绝对，这样 config.json 里写
    /// `./tools/foo.exe` 拷到别的机器也能用。
    fn normalize_target(target: &str) -> String {
        crate::config_store::normalize_path(target)
    }

    /// 推断 "Start in"：未指定时取 target 父目录（对 URL 不生效）；
    /// 若指定的目录实际不存在，返回空串，让 Shell 自己决定
    /// （避免 ShellExecuteExW 因 workdir 无效直接失败）。
    /// 相对路径的 startIn 按 portable 目录解析。
    fn infer_workdir(item: &LaunchItem, target: &str) -> String {
        let raw = item.start_in.trim();
        if !raw.is_empty() {
            let resolved = crate::config_store::resolve_dir(raw);
            if resolved.is_dir() {
                return resolved.to_string_lossy().to_string();
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
        // Undefined ${VAR} would otherwise produce a nonsensical path
        let missing = crate::config_store::unresolved_vars(&item.target);
        if !missing.is_empty() {
            return Err(format!(
                "未定义的路径变量: {}\n  target = {}\n请在 设置 → 路径变量 中添加",
                missing.join(", "),
                item.target
            ));
        }

        let target = normalize_target(&item.target);
        let workdir = infer_workdir(item, &target);

        // Expand args too, so things like ${RED}\excel can be passed through
        let arguments = crate::config_store::expand_vars(&item.arguments);
        let file_w = to_wide(&target);
        let params_w = to_wide(&arguments);
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
        info.lpParameters = if arguments.is_empty() {
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
                args = arguments,
                workdir = if workdir.is_empty() { "<默认>".to_string() } else { workdir.clone() }
            ));
        }
        Ok(())
    }

    /// 把一个路径用 `explorer /select,<path>` 高亮显示（若是目录则直接打开）。
    pub fn reveal(target: &str) -> Result<(), String> {
        // 1) 解析到绝对路径
        let abs = resolve_to_absolute(target)?;
        let p = Path::new(&abs);

        // 2) 如果是目录 → 直接 explorer <dir>
        //    如果是文件 → explorer /select,<file>
        //    如果不存在（可能是 UNC 或无权限）→ 兜底 explorer <父目录>
        let (verb_args_string, dir_opt) = if p.is_dir() {
            (String::new(), Some(abs.clone()))
        } else if p.exists() {
            (format!("/select,\"{}\"", abs), None)
        } else {
            // 不存在：尝试打开父目录
            match p.parent() {
                Some(parent) if parent.as_os_str().len() > 0 && parent.is_dir() => (
                    String::new(),
                    Some(parent.to_string_lossy().to_string()),
                ),
                _ => return Err(format!("目标不存在：{abs}")),
            }
        };

        // 用 ShellExecuteExW 启动 explorer
        let file_w = to_wide("explorer.exe");
        let (params_w, dir_w, has_params, has_dir);
        if !verb_args_string.is_empty() {
            params_w = to_wide(&verb_args_string);
            dir_w = Vec::<u16>::new();
            has_params = true;
            has_dir = false;
        } else if let Some(d) = &dir_opt {
            // explorer <dir> 等价于把 dir 作为参数
            params_w = to_wide(&format!("\"{}\"", d));
            dir_w = Vec::<u16>::new();
            has_params = true;
            has_dir = false;
        } else {
            params_w = Vec::<u16>::new();
            dir_w = Vec::<u16>::new();
            has_params = false;
            has_dir = false;
        }

        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        info.lpVerb = std::ptr::null();
        info.lpFile = file_w.as_ptr();
        info.lpParameters = if has_params {
            params_w.as_ptr()
        } else {
            std::ptr::null()
        };
        info.lpDirectory = if has_dir {
            dir_w.as_ptr()
        } else {
            std::ptr::null()
        };
        info.nShow = SW_SHOWNORMAL as i32;

        let ok = unsafe { ShellExecuteExW(&mut info) };
        if ok == 0 {
            let err = std::io::Error::last_os_error();
            return Err(format!("启动 explorer 失败: {err}"));
        }
        Ok(())
    }

    /// 把 target 解析为绝对路径：
    ///   - 绝对路径 / 相对路径（含分隔符，或 `.`/`..`） → 按 portable 目录解析并规范化
    ///   - 裸命令名（如 "python"） → 用 PATH 查找（逐个目录 + PATHEXT 后缀）
    fn resolve_to_absolute(target: &str) -> Result<String, String> {
        let t = target.trim();
        let normalized = crate::config_store::normalize_path(t);
        if Path::new(&normalized).is_absolute() {
            return Ok(normalized);
        }

        // 裸命令：查 PATH
        let path_env = std::env::var_os("PATH").ok_or("PATH 未设置")?;
        let exts_env = std::env::var_os("PATHEXT").unwrap_or_else(|| {
            std::ffi::OsString::from(".EXE;.BAT;.CMD;.COM")
        });
        let exts: Vec<String> = exts_env
            .to_string_lossy()
            .split(';')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        for dir in std::env::split_paths(&path_env) {
            // 先尝试原名（若用户带了扩展名）
            let direct = dir.join(t);
            if direct.is_file() {
                return Ok(direct.to_string_lossy().to_string());
            }
            // 再尝试附加 PATHEXT 各种后缀
            for ext in &exts {
                let cand = dir.join(format!("{t}{ext}"));
                if cand.is_file() {
                    return Ok(cand.to_string_lossy().to_string());
                }
            }
        }
        Err(format!("在 PATH 中找不到命令：{t}"))
    }
}

#[cfg(not(windows))]
mod win {
    use super::LaunchItem;
    pub fn execute(_item: &LaunchItem) -> Result<(), String> {
        Err("Only Windows is supported".into())
    }
    pub fn reveal(_target: &str) -> Result<(), String> {
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

/// Tauri command：在资源管理器中定位到该 target。
///
/// 规则：
///   - URL（http/https）→ 报错让前端禁用
///   - 绝对文件路径（exe/bat/任意文件）→ `explorer /select,<path>` 高亮选中
///   - 目录 → 直接 `explorer <path>`（打开该目录）
///   - 裸命令名（不含路径分隔符）→ 先 `where <cmd>` 找绝对路径再 select；找不到报错
///   - 相对路径 → 按 portable 目录拼绝对再处理
#[tauri::command]
pub fn reveal_in_explorer(target: String) -> Result<(), String> {
    let t = target.trim();
    if t.is_empty() {
        return Err("目标为空".into());
    }
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("file://") {
        return Err("URL 类命令无法定位到文件夹".into());
    }

    #[cfg(windows)]
    {
        win::reveal(t)
    }
    #[cfg(not(windows))]
    {
        let _ = t;
        Err("only on Windows".into())
    }
}

//! 配置文件读写模块（Portable 模式）。
//!
//! - 生产环境：读写 exe 同目录的 `config.json`
//! - dev 环境（`cargo tauri dev`）：读写工程根目录（`src-tauri/../config.json`），
//!   避免写进 `src-tauri/target/debug/`。
//!
//! 前端完全掌控"要保存什么"——Rust 端不解析内容，只负责序列化后的字符串读写。

use std::fs;
use std::path::PathBuf;

/// 计算 Portable 目录。
///
/// 规则：
///   - dev 模式：当且仅当 exe 位于 `.../src-tauri/target/{debug,release}/...` 下时，
///     才把 portable 目录指向工程根（含 `package.json` 和 `src-tauri/`）。
///     这样 `cargo tauri dev` 不会写到 target/ 里。
///   - 其他所有情况：portable 目录 = exe 所在目录（Portable 分发的本意）。
///
/// 之前的实现会向上遍历 5 层查找含 `src-tauri` 的祖先；
/// 这会让 portable exe 放在工程子目录（例如 `dist-portable/QuickLauncher/`）时
/// 被误判为 dev，从而读到工程根的 `config.json`。所以这里收紧为只认
/// target/{debug,release} 路径。
pub fn portable_dir() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let exe_dir = exe
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    // 只在 exe 位于 src-tauri/target/{debug,release}/ 下时才视作 dev
    let mut in_tauri_target = false;
    {
        let mut it = exe_dir.ancestors();
        // ancestors: exe_dir -> parent -> ... 依次检查最近三级
        // 结构要求：.../<root>/src-tauri/target/{debug|release}[/deps/...]
        for _ in 0..4 {
            let Some(p) = it.next() else { break };
            // 当前段 == debug/release
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name == "debug" || name == "release" {
                if let Some(parent) = p.parent() {
                    let pname = parent.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if pname == "target" {
                        if let Some(tauri_dir) = parent.parent() {
                            let tname =
                                tauri_dir.file_name().and_then(|s| s.to_str()).unwrap_or("");
                            if tname == "src-tauri" {
                                in_tauri_target = true;
                            }
                        }
                    }
                }
                break;
            }
        }
    }

    if in_tauri_target {
        // 向上走到工程根（含 package.json + src-tauri/）
        let mut cur = exe_dir.clone();
        for _ in 0..6 {
            if cur.join("src-tauri").is_dir() && cur.join("package.json").is_file() {
                return cur;
            }
            match cur.parent() {
                Some(p) => cur = p.to_path_buf(),
                None => break,
            }
        }
        // 兜底
        return exe_dir;
    }

    // 生产 / Portable：就是 exe 所在目录
    exe_dir
}

pub fn config_path() -> PathBuf {
    portable_dir().join("config.json")
}

pub fn icons_dir() -> PathBuf {
    portable_dir().join("icons")
}

/// 读取配置 JSON 字符串。文件不存在时返回空字符串（让前端用默认配置）。
#[tauri::command]
pub fn load_config() -> Result<String, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("read config failed: {e}"))
}

/// 保存配置 JSON 字符串
#[tauri::command]
pub fn save_config(content: String) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    // 原子写：先写入临时文件再重命名，避免半写入
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("write tmp failed: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

/// 返回 portable 目录（给前端显示/调试用）
#[tauri::command]
pub fn portable_dir_path() -> String {
    portable_dir().to_string_lossy().to_string()
}

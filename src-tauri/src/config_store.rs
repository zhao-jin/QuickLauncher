//! 配置文件读写模块（Portable 模式）。
//!
//! - 生产环境：读写 exe 同目录的 `config.json`
//! - dev 环境（`cargo tauri dev`）：读写工程根目录（`src-tauri/../config.json`），
//!   避免写进 `src-tauri/target/debug/`。
//!
//! 前端完全掌控"要保存什么"——Rust 端不解析内容，只负责序列化后的字符串读写。

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

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

/// Lexically resolve `.` and `..` without touching the filesystem.
/// Unlike `fs::canonicalize` this works for non-existing paths and never
/// produces a `\\?\` prefix.
fn clean_path(path: &Path) -> PathBuf {
    let mut comps = path.components().peekable();
    let mut out = match comps.peek() {
        Some(c @ Component::Prefix(..)) => {
            let c = *c;
            comps.next();
            PathBuf::from(c.as_os_str())
        }
        _ => PathBuf::new(),
    };
    for c in comps {
        match c {
            Component::Prefix(..) => {}
            Component::RootDir => out.push(c.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(seg) => out.push(seg),
        }
    }
    out
}

/// A bare command name is resolved by the Shell via PATH (e.g. `python`).
/// `.` and `..` contain no separator but are still paths, not commands.
fn is_bare_command(t: &str) -> bool {
    !t.contains(std::path::MAIN_SEPARATOR) && !t.contains('/') && t != "." && t != ".."
}

/// Named root directories (e.g. `RED` → `I:\RED`), pushed in by the frontend
/// after it loads `config.json`. Keeping them here means Rust never has to
/// parse the config structure itself.
static PATH_ROOTS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn path_roots() -> &'static Mutex<HashMap<String, String>> {
    PATH_ROOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Tauri command: replace the named-root table.
#[tauri::command]
pub fn set_path_roots(roots: HashMap<String, String>) {
    if let Ok(mut guard) = path_roots().lock() {
        *guard = roots;
    }
}

/// Max substitution passes, so a root referring to itself cannot hang us.
const MAX_EXPAND_PASSES: usize = 8;

/// Look up a variable: config roots first, then process environment.
fn lookup_var(name: &str) -> Option<String> {
    if let Ok(guard) = path_roots().lock() {
        // Case-insensitive match, matching Windows path conventions.
        if let Some(v) = guard.get(name) {
            return Some(v.clone());
        }
        for (k, v) in guard.iter() {
            if k.eq_ignore_ascii_case(name) {
                return Some(v.clone());
            }
        }
    }
    std::env::var(name).ok()
}

/// Expand `${NAME}` references. Unknown names are left verbatim so callers can
/// surface a useful error instead of silently building a wrong path.
pub fn expand_vars(input: &str) -> String {
    let mut current = input.to_string();
    for _ in 0..MAX_EXPAND_PASSES {
        if !current.contains("${") {
            break;
        }
        let mut out = String::with_capacity(current.len());
        let mut rest = current.as_str();
        let mut changed = false;
        while let Some(start) = rest.find("${") {
            let Some(end_rel) = rest[start + 2..].find('}') else {
                break;
            };
            let end = start + 2 + end_rel;
            let name = &rest[start + 2..end];
            out.push_str(&rest[..start]);
            match lookup_var(name.trim()) {
                Some(value) => {
                    out.push_str(value.trim_end_matches(['\\', '/']));
                    changed = true;
                }
                None => out.push_str(&rest[start..=end]),
            }
            rest = &rest[end + 1..];
        }
        out.push_str(rest);
        current = out;
        if !changed {
            break;
        }
    }
    current
}

/// Names still unresolved after expansion (i.e. undefined variables).
pub fn unresolved_vars(input: &str) -> Vec<String> {
    let expanded = expand_vars(input);
    let mut names = Vec::new();
    let mut rest = expanded.as_str();
    while let Some(start) = rest.find("${") {
        let Some(end_rel) = rest[start + 2..].find('}') else {
            break;
        };
        let end = start + 2 + end_rel;
        names.push(rest[start + 2..end].trim().to_string());
        rest = &rest[end + 1..];
    }
    names
}

/// Normalize a path for portable use.
///
/// Order matters: `${VAR}` is expanded first, because only afterwards can we
/// tell whether the result is absolute (`${RED}\x` → `I:\RED\x`) or relative.
///
/// - URL (http/https/file) → unchanged
/// - bare command name (no path separator) → unchanged (Shell finds it via PATH)
/// - absolute path → cleaned (`.`/`..` resolved)
/// - relative path (contains a separator, or is `.`/`..`) → resolved against
///   the portable dir
///
/// This lets `config.json` use paths like `./tools/foo.exe`, `../shared/bar.exe`
/// or `${RED}/mtool/m.py` so the whole folder can be copied to another machine
/// and still work, regardless of the process working directory.
pub fn normalize_path(p: &str) -> String {
    let expanded = expand_vars(p.trim());
    let t = expanded.trim();
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("file://") {
        return t.to_string();
    }
    if is_bare_command(t) {
        return t.to_string();
    }
    let path = Path::new(t);
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        portable_dir().join(path)
    };
    clean_path(&joined).to_string_lossy().to_string()
}

/// Resolve a directory path. Unlike `normalize_path` there is no PATH-lookup
/// semantics, so a bare name like `tools` is relative to the portable dir.
pub fn resolve_dir(p: &str) -> PathBuf {
    let expanded = expand_vars(p.trim());
    let path = Path::new(expanded.trim());
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        portable_dir().join(path)
    };
    clean_path(&joined)
}

#[cfg(all(test, windows))]
mod tests {
    use super::clean_path;
    use std::path::Path;

    fn clean(p: &str) -> String {
        clean_path(Path::new(p)).to_string_lossy().to_string()
    }

    #[test]
    fn resolves_parent_and_current_dir() {
        assert_eq!(clean(r"M:\a\b\..\c\d.exe"), r"M:\a\c\d.exe");
        assert_eq!(clean(r"M:\a\.\b.exe"), r"M:\a\b.exe");
        assert_eq!(clean(r"M:\a\b\..\..\tools\x.exe"), r"M:\tools\x.exe");
    }

    #[test]
    fn keeps_roots_intact() {
        assert_eq!(clean(r"M:\"), r"M:\");
        assert_eq!(clean(r"C:\Windows\explorer.exe"), r"C:\Windows\explorer.exe");
        assert_eq!(clean(r"\\srv\share\a\..\b.exe"), r"\\srv\share\b.exe");
    }

    #[test]
    fn normalizes_forward_slashes() {
        assert_eq!(clean("M:/a/./b/../c.exe"), r"M:\a\c.exe");
    }

    #[test]
    fn dots_are_paths_not_commands() {
        use super::is_bare_command;
        assert!(is_bare_command("python"));
        assert!(is_bare_command("explorer.exe"));
        assert!(!is_bare_command("."));
        assert!(!is_bare_command(".."));
        assert!(!is_bare_command(r".\tools\x.exe"));
        assert!(!is_bare_command("tools/x.exe"));
    }

    #[test]
    fn expands_named_roots() {
        use super::{expand_vars, set_path_roots, unresolved_vars};
        use std::collections::HashMap;

        let mut roots = HashMap::new();
        roots.insert("RED".to_string(), r"I:\RED".to_string());
        roots.insert("Self".to_string(), r"E:\self\".to_string());
        set_path_roots(roots);

        assert_eq!(expand_vars(r"${RED}\mtool\m.py"), r"I:\RED\mtool\m.py");
        // trailing separator in the root must not double up
        assert_eq!(expand_vars(r"${Self}\bats\x.bat"), r"E:\self\bats\x.bat");
        // case-insensitive, like Windows paths
        assert_eq!(expand_vars(r"${red}\a"), r"I:\RED\a");
        // multiple refs in one string
        assert_eq!(expand_vars(r"${RED}\a ${Self}\b"), r"I:\RED\a E:\self\b");
        // unknown names survive verbatim and are reported
        assert_eq!(expand_vars(r"${NOPE}\a"), r"${NOPE}\a");
        assert_eq!(unresolved_vars(r"${NOPE}\a"), vec!["NOPE".to_string()]);
        assert!(unresolved_vars(r"${RED}\a").is_empty());
        // unterminated brace must not panic or loop
        assert_eq!(expand_vars("${RED"), "${RED");

        set_path_roots(HashMap::new());
    }

    #[test]
    fn self_referencing_root_terminates() {
        use super::{expand_vars, set_path_roots};
        use std::collections::HashMap;

        let mut roots = HashMap::new();
        roots.insert("LOOP".to_string(), "${LOOP}/x".to_string());
        set_path_roots(roots);
        // Must return rather than hang; exact value is unimportant.
        let _ = expand_vars("${LOOP}/a");
        set_path_roots(HashMap::new());
    }
}

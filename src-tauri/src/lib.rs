//! Quick Launcher - Tauri 2 主入口

mod config_store;
mod icon;
mod launcher;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

const MAIN_WINDOW_LABEL: &str = "main";
const DEFAULT_HOTKEY: &str = "Ctrl+`";

/// 全局状态：当前绑定的热键
struct HotkeyState(Mutex<Option<Shortcut>>);

// ============ 窗口控制 ============

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ============ 毛玻璃效果（Win11 Mica，Win10 Acrylic） ============

fn apply_window_effects(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        // 先试 Mica（仅 Win11 22H2+ 生效），失败再退回 Acrylic（Win10/11 都可）
        if apply_mica(window, Some(true)).is_err() {
            let _ = apply_acrylic(window, Some((20, 20, 22, 200)));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
}

// ============ 托盘 ============

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "设置...", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &settings_i, &quit_i])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("Quick Launcher")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "settings" => {
                show_main_window(app);
                // 前端监听 "open-settings" 事件打开设置面板
                let _ = app.emit_to(MAIN_WINDOW_LABEL, "open-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// ============ 全局热键：解析与注册 ============

/// 把字符串 "Ctrl+`" / "Ctrl+Alt+Space" 解析为 Shortcut
fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
    let mut mods = Modifiers::empty();
    let mut code: Option<Code> = None;
    for raw in s.split('+') {
        let part = raw.trim();
        if part.is_empty() {
            continue;
        }
        match part.to_ascii_uppercase().as_str() {
            "CTRL" | "CONTROL" => mods |= Modifiers::CONTROL,
            "SHIFT" => mods |= Modifiers::SHIFT,
            "ALT" => mods |= Modifiers::ALT,
            "SUPER" | "WIN" | "META" | "CMD" => mods |= Modifiers::SUPER,
            key => {
                code = Some(parse_code(key).ok_or_else(|| format!("未识别按键: {key}"))?);
            }
        }
    }
    let code = code.ok_or_else(|| "必须包含一个非修饰键".to_string())?;
    Ok(Shortcut::new(Some(mods), code))
}

fn parse_code(k: &str) -> Option<Code> {
    let up = k.to_ascii_uppercase();
    Some(match up.as_str() {
        "`" | "BACKQUOTE" | "~" => Code::Backquote,
        "-" | "MINUS" => Code::Minus,
        "=" | "EQUAL" => Code::Equal,
        "[" | "BRACKETLEFT" => Code::BracketLeft,
        "]" | "BRACKETRIGHT" => Code::BracketRight,
        "\\" | "BACKSLASH" => Code::Backslash,
        ";" | "SEMICOLON" => Code::Semicolon,
        "'" | "QUOTE" => Code::Quote,
        "," | "COMMA" => Code::Comma,
        "." | "PERIOD" => Code::Period,
        "/" | "SLASH" => Code::Slash,
        "SPACE" => Code::Space,
        "ENTER" | "RETURN" => Code::Enter,
        "TAB" => Code::Tab,
        "ESC" | "ESCAPE" => Code::Escape,
        k if k.starts_with('F') && k.len() <= 3 => match k {
            "F1" => Code::F1,  "F2" => Code::F2,  "F3" => Code::F3,  "F4" => Code::F4,
            "F5" => Code::F5,  "F6" => Code::F6,  "F7" => Code::F7,  "F8" => Code::F8,
            "F9" => Code::F9,  "F10" => Code::F10, "F11" => Code::F11, "F12" => Code::F12,
            _ => return None,
        },
        k if k.len() == 1 => {
            let c = k.chars().next().unwrap();
            if c.is_ascii_alphabetic() {
                // A..Z
                match c {
                    'A' => Code::KeyA, 'B' => Code::KeyB, 'C' => Code::KeyC, 'D' => Code::KeyD,
                    'E' => Code::KeyE, 'F' => Code::KeyF, 'G' => Code::KeyG, 'H' => Code::KeyH,
                    'I' => Code::KeyI, 'J' => Code::KeyJ, 'K' => Code::KeyK, 'L' => Code::KeyL,
                    'M' => Code::KeyM, 'N' => Code::KeyN, 'O' => Code::KeyO, 'P' => Code::KeyP,
                    'Q' => Code::KeyQ, 'R' => Code::KeyR, 'S' => Code::KeyS, 'T' => Code::KeyT,
                    'U' => Code::KeyU, 'V' => Code::KeyV, 'W' => Code::KeyW, 'X' => Code::KeyX,
                    'Y' => Code::KeyY, 'Z' => Code::KeyZ,
                    _ => return None,
                }
            } else if c.is_ascii_digit() {
                match c {
                    '0' => Code::Digit0, '1' => Code::Digit1, '2' => Code::Digit2,
                    '3' => Code::Digit3, '4' => Code::Digit4, '5' => Code::Digit5,
                    '6' => Code::Digit6, '7' => Code::Digit7, '8' => Code::Digit8,
                    '9' => Code::Digit9,
                    _ => return None,
                }
            } else {
                return None;
            }
        }
        _ => return None,
    })
}

fn bind_shortcut(app: &AppHandle, combo: &str) -> Result<(), String> {
    let state = app.state::<HotkeyState>();
    let shortcut = parse_shortcut(combo)?;

    // 先解绑旧的
    {
        let mut guard = state.0.lock().unwrap();
        if let Some(old) = guard.take() {
            let _ = app.global_shortcut().unregister(old);
        }
        *guard = Some(shortcut);
    }

    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _sc, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_main_window(&app_handle);
            }
        })
        .map_err(|e| format!("注册热键失败: {e}"))
}

/// 前端可调用的重绑命令
#[tauri::command]
fn set_hotkey(app: AppHandle, combo: String) -> Result<(), String> {
    bind_shortcut(&app, &combo)
}

/// 前端调用：真正退出进程（绕过 close→hide 拦截）
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ============ 入口 ============

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(HotkeyState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            launcher::launch_item,
            config_store::load_config,
            config_store::save_config,
            config_store::portable_dir_path,
            icon::extract_icon_to_png,
            icon::enumerate_resource_icons,
            icon::extract_resource_icons_range,
            set_hotkey,
            quit_app,
        ])
        .setup(|app| {
            setup_tray(app.handle())?;

            // 给主窗口套毛玻璃
            if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                apply_window_effects(&win);
            }

            // 默认热键
            if let Err(e) = bind_shortcut(app.handle(), DEFAULT_HOTKEY) {
                eprintln!("默认热键注册失败: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW_LABEL {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running quick-launcher");
}

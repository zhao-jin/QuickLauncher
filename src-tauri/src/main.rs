// 禁用 Windows 发布时的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quick_launcher_lib::run();
}

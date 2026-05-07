# Quick Launcher

一个类似 [MadAppLauncher](http://madapplauncher.sourceforge.net/) 的极简快速启动器，Windows 专用，绿色免安装。Tauri 2 + React + TypeScript 实现。

> 全局热键呼出 → 键盘一键命中 → 启动即隐藏。追求最低摩擦、最小资源占用。

![platform](https://img.shields.io/badge/platform-Windows%2010%2B-blue)
![tauri](https://img.shields.io/badge/Tauri-2-yellow)
![license](https://img.shields.io/badge/license-MIT-green)

## 特性

- 🎯 **托盘常驻**，任务栏不占位
- ⌨️ **全局快捷键** `Ctrl+\`` 一键呼出/隐藏（可在设置里改）
- 🧩 **多 Tab 分类** + 可配置 M×N 网格（默认 10×3） + F1-F10 顶栏
- 🎹 **全键盘操作**：字母/数字/符号/方向/小键盘全部可绑定
- 🎨 **Mica / Acrylic 毛玻璃 UI**（Win11/Win10 自动适配）
- ⚡ **资源占用极低**：exe 3.5 MB，空闲内存 <40 MB，CPU 0%
- 📦 **Portable 分发**：exe + config.json 同目录，拷走即用
- 🖼️ **图标三模式**：
  - Default — 自动从 target 提取 Shell 图标
  - Custom — 任意 png / ico / jpg 图片
  - Resource — 从 `shell32.dll` 等 PE 资源按 index 选图（仿 Windows "更改图标"对话框）
- 🖱️ **完整交互**：左键启动 / 右键菜单（复制/剪切/粘贴/编辑/删除）/ 拖拽移动或交换 / 外部文件拖入
- 🔄 **从 MadAppLauncher 迁移**：一键转换 `.mal` 配置文件

## 预览

主界面：

```
Quick Launcher · RED                              ⚙ − ×
┌──────────────────────────── F1-F10 顶栏 ────────────────────────────┐
│ 资源管理器  记事本   计算器   命令行   PowerShell  …                │
├───── Tabs: AA · MW · MW2 · MAY · Metro · RED · [+] ─────────────────┤
│                                                                     │
│  Q         W         E         R         T         Y         U      │
│  editor    ds.70     tds70     tds71     SrcLs     clt       kubl   │
│                                                                     │
│  A         S         D         F         G         H         J      │
│  killall   kill-noed kill-ed   killds    killclt   ll        kbl    │
│                                                                     │
│  Z         X         C         V         B         N         M      │
│  REDDS     excel     disable   enable    kill      kl        kbl2   │
└─────────────────────────────────────────────────────────────────────┘
```

## 使用

### 方式一：下载 Portable 包

1. 跑一次 `npm run release` 生成 `dist-portable/QuickLauncher-portable.zip`
2. 解压到任意目录，双击 `QuickLauncher.exe`
3. 按 `Ctrl+\`` 呼出

### 方式二：本地开发

```bash
# 安装前端依赖
npm install

# 启动开发模式（首次编译 Rust 约 1-2 分钟）
npm run tauri:dev
```

### 交互速查

| 操作 | 效果 |
|------|------|
| `Ctrl+\`` | 呼出 / 隐藏主窗口 |
| `Esc` | 隐藏窗口 |
| 格子上按对应字母/数字键 | 启动该按钮 |
| `F1-F10` | 启动顶栏按钮 |
| `Ctrl+1..9/0` | 快速切换 Tab |
| 左键 | 启动 |
| 右键 | 弹出菜单（编辑/复制/剪切/粘贴/删除） |
| 拖拽按钮 | 移动或交换位置（跨 F 行 / 主网格） |
| 拖入 exe/文件 | 自动新增按钮 |
| Tab 标签右键 | 重命名 / 删除 |

## 从 MadAppLauncher 迁移

```bash
# 从 .mal 转成默认配置（默认读 d:\tools\MadAppLauncher\miles.mal）
npm run convert:mal -- <your.mal>

# 重新打包，新配置会自动注入 portable 包
npm run release
```

转换器会：
- 把 `<MATab>` → Tabs，`<MAButton>` → 按钮
- 还原 `buttonID` → 键位（字母/COMMA/PERIOD/SEMICOLON）
- 保留 `iconFile + iconIndex`（作为 resource 模式）
- 映射 `windowStyle`/`runAsAdmin` 等属性
- 为 F1-F10 顶栏填入 Windows 常用程序默认值

## 目录结构

```
src/                  前端 React 代码
  components/         对话框（Edit / Settings / IconPicker / ContextMenu）
  store/              Zustand 状态（含防抖自动保存）
  lib/                IPC 封装 / 图标 hook / 热键工具
  types/              共享类型
  styles/             Tailwind + 自定义 CSS
src-tauri/
  src/
    lib.rs            入口：单实例 + 托盘 + 全局热键 + 毛玻璃
    launcher.rs       ShellExecuteExW 统一启动
    icon.rs           SHGetFileInfoW / ExtractIconExW 提图标
    config_store.rs   Portable 配置读写（严格区分 dev / release）
  tauri.conf.json     窗口配置（透明无边框 + skipTaskbar + dragDropEnabled:false）
scripts/
  convert-mal.mjs     MadAppLauncher .mal → config.json
  default-config.json 默认配置（转换结果，打入 portable 包）
  pack-portable.ps1   Portable 打包脚本
  USAGE.md            随 portable 包分发的使用说明
```

## 构建要求

- Node.js ≥ 18
- Rust stable（MSVC 工具链）
- Windows 10 1809+ / Windows 11
- Visual Studio 2022 Build Tools（含 "C++ 桌面开发" 工作负载）

## 技术要点

- **透明无边框 + Mica 毛玻璃**：`window-vibrancy` crate，Win11 Mica / Win10 Acrylic 自动降级
- **全局热键动态重绑**：前端改完热键调 `set_hotkey` 命令，后端 unregister + register
- **按 PE 资源提取图标**：`ExtractIconExW(file, index, ...)` 取 HICON，GDI 转 RGBA，`image` crate 写 PNG；带缓存（SHA1 hash）
- **HTML5 拖拽兼容**：`dragDropEnabled: false` 关掉 Tauri 的 OS 级文件拖放拦截，让网页 `dragstart/drop` 正常工作（外部文件拖入走标准 `DataTransfer.files`，两全）
- **Portable 目录检测**：严格只认 `src-tauri/target/{debug,release}/` 为 dev 模式；其他任何位置（包括 `dist-portable/QuickLauncher/`）一律按 exe 同目录当 portable dir

## 常用命令

```bash
npm run tauri:dev       # 开发模式
npm run tauri:build     # 编译 release
npm run convert:mal     # .mal → default-config.json
npm run pack:portable   # 打 portable zip（依赖已构建的 exe）
npm run release         # build + pack 一条龙
```

## License

MIT

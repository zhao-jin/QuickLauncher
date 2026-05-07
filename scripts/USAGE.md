# Quick Launcher · 使用说明

一个轻量级的 Windows 快速启动器，类似 MadAppLauncher。

---

## 文件说明

```
QuickLauncher/
├── QuickLauncher.exe   ← 主程序，双击即可运行
├── config.json         ← 配置文件（首次运行自动生成）
└── icons/              ← 图标缓存（自动生成）
```

> **Portable 绿色模式**：所有数据都存在本文件夹内，不写注册表。
> 删除整个文件夹即可卸载。

---

## 快速开始

1. **双击 `QuickLauncher.exe`**
2. 程序会**静默驻留系统托盘**（右下角 `^` 箭头展开可看到图标）
3. 按 `Ctrl + ~` 呼出主面板
4. 点击任意格子启动示例命令（记事本 / 计算器 / 浏览器 等）

---

## 操作

| 操作 | 效果 |
|---|---|
| `Ctrl + ~` | 呼出 / 隐藏主面板 |
| 单击格子 | 启动该命令 |
| 按键盘对应键（`Q` / `W` / `F1` 等） | 启动对应格子 |
| 右键格子 | 编辑 / 删除 |
| 左键空格子 | 新增命令 |
| 拖文件到格子 | 自动添加 |
| `Ctrl + 1~9` | 切换 Tab |
| `Esc` | 隐藏窗口 |
| 右键托盘图标 | 显示 / 设置 / 退出 |
| 点面板右上角 ⚙ | 打开设置 |

---

## 设置面板

- **全局快捷键**：点"请按下组合键..."录入新热键（支持 Ctrl/Shift/Alt/Win + 字母/数字/F键/特殊符号）
- **布局**：列数 6-14 / 行数 2-5（支持数字行、小键盘行）
- **行为**：失焦自动隐藏、启动后自动隐藏
- **外观**：面板不透明度 60%-100%

---

## 命令类型（编辑格子时填 Target）

| Target 形式 | 行为 |
|---|---|
| `C:\Path\to\app.exe` | 启动 exe |
| `notepad.exe` | 启动系统 PATH 中的程序 |
| `D:\scripts\build.bat` | 运行批处理 |
| `https://example.com` | 用默认浏览器打开 |
| `D:\MyProject` | 在资源管理器打开文件夹 |
| `file.pdf` | 走默认关联程序 |

同时支持：
- **Arguments**：启动参数
- **Start in**：工作目录（留空自动取 Target 所在目录）
- **Run**：Normal / Minimized / Maximized / Hidden
- **Run as administrator**：管理员权限（触发 UAC）

---

## 常见问题

### Q：快捷键 `Ctrl+~` 无响应？
A：可能被其他程序占用。打开设置改为其他组合（比如 `Ctrl+Alt+Space`）。

### Q：怎么开机自启？
A：在 Windows `shell:startup` 目录里放 `QuickLauncher.exe` 的快捷方式即可。

### Q：支持 Windows 7/8 吗？
A：**不支持**。要求 Windows 10 1809 或以上，需要 WebView2 Runtime（Windows 11 内置；Windows 10 会在首次运行时自动安装）。

### Q：想备份配置？
A：复制整个文件夹即可。迁移到新电脑也是复制粘贴。

---

## 技术信息

- 基于 Tauri 2 + React + TypeScript
- 窗口特效：Windows 11 使用 Mica 毛玻璃，Windows 10 使用 Acrylic
- 资源占用：空闲 <50MB 内存、CPU 0%
- 配置存储：程序同目录 `config.json`（纯 JSON，可手动编辑）

# ====================================================================
# QuickLauncher — 把当前目录的 portable exe 注册到 Windows 开始菜单
# ====================================================================
#
# 用法（在 portable 包目录下）：
#   powershell -ExecutionPolicy Bypass -File install-startmenu.ps1
#
# 或者随项目仓库使用：
#   npm run install:startmenu
#
# 行为：
#   1. 找到本脚本所在目录（即 QuickLauncher portable 包）下的 QuickLauncher.exe
#   2. 在 %APPDATA%\Microsoft\Windows\Start Menu\Programs\ 创建 QuickLauncher.lnk
#   3. 工作目录指向 exe 同目录（保证 config.json/icons 缓存读写到正确位置）
#   4. 图标使用 exe 自身的图标
#   5. 不需要管理员权限（per-user）
#
# 卸载：执行 uninstall-startmenu.ps1
# ====================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Find-Exe {
    # 候选 1：脚本同级目录（portable 包场景）
    $here = Split-Path -Parent $MyInvocation.PSCommandPath
    $cand1 = Join-Path $here "QuickLauncher.exe"
    if (Test-Path $cand1) { return (Resolve-Path $cand1).Path }

    # 候选 2：项目仓库 dev 场景：scripts/install-startmenu.ps1 → ../dist-portable/QuickLauncher/QuickLauncher.exe
    $cand2 = Join-Path $here "..\dist-portable\QuickLauncher\QuickLauncher.exe"
    if (Test-Path $cand2) { return (Resolve-Path $cand2).Path }

    # 候选 3：项目仓库 dev 场景：scripts/install-startmenu.ps1 → ../src-tauri/target/release/quick-launcher.exe
    $cand3 = Join-Path $here "..\src-tauri\target\release\quick-launcher.exe"
    if (Test-Path $cand3) { return (Resolve-Path $cand3).Path }

    return $null
}

$exe = Find-Exe
if (-not $exe) {
    Write-Host "[ERROR] 找不到 QuickLauncher.exe" -ForegroundColor Red
    Write-Host "  请先把本脚本复制到 portable 包根目录（含 QuickLauncher.exe 的目录）后再运行。"
    Write-Host "  或在仓库根先执行: npm run release   生成 dist-portable/QuickLauncher/"
    exit 1
}

$exeDir   = Split-Path -Parent $exe
$startMenu = [Environment]::GetFolderPath("Programs")  # %APPDATA%\Microsoft\Windows\Start Menu\Programs
$lnkPath   = Join-Path $startMenu "QuickLauncher.lnk"

# 创建快捷方式（用 WScript.Shell COM 对象，原生 Windows API，无依赖）
$shell = New-Object -ComObject WScript.Shell
$lnk   = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath       = $exe
$lnk.WorkingDirectory = $exeDir
$lnk.IconLocation     = "$exe,0"
$lnk.Description      = 'Quick Launcher - keyboard-driven launcher with global hotkey Ctrl+backtick'
$lnk.WindowStyle      = 1   # 1=Normal, 7=Minimized
$lnk.Save()

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "  Installed to Start Menu [OK]" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host "  Shortcut : $lnkPath"
Write-Host "  Target   : $exe"
Write-Host "  Workdir  : $exeDir"
Write-Host ""
Write-Host "  Open Start Menu and search 'Quick Launcher' to launch it."
Write-Host "  Right-click the search result -> 'Pin to Start' / 'Pin to taskbar'."
Write-Host "  To remove the shortcut, run uninstall-startmenu.ps1"
Write-Host "======================================" -ForegroundColor Green

# ====================================================================
# QuickLauncher — 从 Windows 开始菜单移除快捷方式
# ====================================================================
# 用法：
#   powershell -ExecutionPolicy Bypass -File uninstall-startmenu.ps1
#
# 仅删除 install-startmenu.ps1 创建的 .lnk 快捷方式；
# 不会删除 QuickLauncher.exe 本身和 config.json / icons 缓存。
# ====================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$startMenu = [Environment]::GetFolderPath("Programs")
$lnkPath   = Join-Path $startMenu "QuickLauncher.lnk"

if (Test-Path $lnkPath) {
    Remove-Item $lnkPath -Force
    Write-Host "[OK] Removed: $lnkPath" -ForegroundColor Green
} else {
    Write-Host "[INFO] No shortcut found at: $lnkPath"
}

# 注意：用户若把快捷方式手动"固定到开始屏幕"或"固定到任务栏"，
# 那是 Windows 拷贝的副本，需用户自己右键取消固定。
Write-Host ""
Write-Host "如果之前把它固定到了开始屏幕/任务栏，请手动右键 -> 取消固定。"

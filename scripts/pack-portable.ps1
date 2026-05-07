# Portable 打包脚本
# 用法：powershell -ExecutionPolicy Bypass -File scripts/pack-portable.ps1
#
# 产出：
#   dist-portable/QuickLauncher/QuickLauncher.exe
#   dist-portable/QuickLauncher/README.md
#   dist-portable/QuickLauncher/icons/
#   dist-portable/QuickLauncher/config.json (若存在 scripts/default-config.json)
#   dist-portable/QuickLauncher-portable.zip
#
# exe 查找顺序：
#   1) src-tauri/target/release/quick-launcher.exe  （刚跑完 tauri build）
#   2) dist-portable/QuickLauncher/QuickLauncher.exe （上次 stage 结果）
#   3) 解压 dist-portable/QuickLauncher-portable.zip 里的 exe
# 3 种来源都找不到才报错。

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outDir   = Join-Path $root "dist-portable"
$stageDir = Join-Path $outDir "QuickLauncher"
$zipPath  = Join-Path $outDir "QuickLauncher-portable.zip"

$candidate1 = Join-Path $root "src-tauri\target\release\quick-launcher.exe"
$candidate2 = Join-Path $stageDir "QuickLauncher.exe"

# 1) 确认 exe 源
$exeSource = $null
$needRestoreFromZip = $false

if (Test-Path $candidate1) {
    $exeSource = $candidate1
    Write-Host "exe source: tauri build output"
} elseif (Test-Path $candidate2) {
    $exeSource = $candidate2
    Write-Host "exe source: existing stage dir"
} elseif (Test-Path $zipPath) {
    Write-Host "exe source: previous zip (will extract)"
    $needRestoreFromZip = $true
} else {
    Write-Host "[ERROR] QuickLauncher.exe not found in any of:" -ForegroundColor Red
    Write-Host "  - $candidate1" -ForegroundColor Red
    Write-Host "  - $candidate2" -ForegroundColor Red
    Write-Host "  - $zipPath" -ForegroundColor Red
    Write-Host "Run: npm run tauri:build" -ForegroundColor Yellow
    exit 1
}

# 2) 关闭可能占用 exe 的进程，避免覆盖失败
Get-Process QuickLauncher    -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process quick-launcher   -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

# 3) 先把 exe 备份到临时位置（防止清理 outDir 时把自己删掉）
$tmpExe = Join-Path $env:TEMP "QuickLauncher-stage.exe"
if ($needRestoreFromZip) {
    $tmpUnzip = Join-Path $env:TEMP ("ql-unzip-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tmpUnzip | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $tmpUnzip -Force
    $extractedExe = Get-ChildItem -Path $tmpUnzip -Recurse -Filter "QuickLauncher.exe" | Select-Object -First 1
    if (-not $extractedExe) {
        Write-Host "[ERROR] zip does not contain QuickLauncher.exe" -ForegroundColor Red
        exit 2
    }
    Copy-Item $extractedExe.FullName $tmpExe -Force
    Remove-Item $tmpUnzip -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Copy-Item $exeSource $tmpExe -Force
}

# 4) 清理 stage 内容（只删 stage 内的子项，不删 stage 目录本身/不删 outDir，
#    避免 explorer/终端等无害锁定整个目录时打包失败）
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}
if (-not (Test-Path $stageDir)) {
    New-Item -ItemType Directory -Path $stageDir | Out-Null
}
Write-Host "Cleaning stage dir contents ..."
Get-ChildItem -Path $stageDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Host "  skip locked: $($_.Name) ($_)" -ForegroundColor Yellow
    }
}

# 5) 放 exe
Copy-Item $tmpExe (Join-Path $stageDir "QuickLauncher.exe")
Remove-Item $tmpExe -Force -ErrorAction SilentlyContinue

# 6) 说明文件（英文名避免编码问题，内容可含中文）
$usage = Join-Path $root "scripts\USAGE.md"
if (Test-Path $usage) {
    Copy-Item $usage (Join-Path $stageDir "README.md")
}

# 7) icons 目录
New-Item -ItemType Directory -Path (Join-Path $stageDir "icons") | Out-Null
"Icon cache (auto-populated at runtime)" | Out-File (Join-Path $stageDir "icons\.keep") -Encoding utf8

# 8) 默认配置（若存在）
$defaultCfg = Join-Path $root "scripts\default-config.json"
if (Test-Path $defaultCfg) {
    Write-Host "Bundling default config.json (imported from MadAppLauncher)..."
    Copy-Item $defaultCfg (Join-Path $stageDir "config.json")
} else {
    Write-Host "No default-config.json found (skip bundling default config)"
}

# 8.5) 安装 / 卸载到开始菜单的辅助脚本
foreach ($name in @("install-startmenu.ps1", "uninstall-startmenu.ps1")) {
    $src = Join-Path $root "scripts\$name"
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $stageDir $name)
    }
}

# 9) 报告
$exeSize   = (Get-Item (Join-Path $stageDir "QuickLauncher.exe")).Length
$exeSizeMB = [math]::Round($exeSize / 1MB, 2)

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "  Portable build completed [OK]" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host "  Stage dir: $stageDir"
Write-Host "  exe size:  $exeSizeMB MB"
Get-ChildItem $stageDir | Select-Object Name, Length | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "  Copy QuickLauncher folder anywhere and double-click the exe."
Write-Host "======================================" -ForegroundColor Green

# 10) 重新打 zip
Write-Host "Compressing to zip..."
try {
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path $stageDir -DestinationPath $zipPath -Force
    $zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Host "  zip: $zipPath ($zipSize MB)" -ForegroundColor Green
} catch {
    Write-Host "  zip failed (ignorable): $_" -ForegroundColor Yellow
}

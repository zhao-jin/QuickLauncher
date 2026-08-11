# Export the launcher's named roots as user environment variables, so other
# tools (bat scripts, cmd, editors) can use the same %NAME% directories.
#
# Reads the roots table from config.json and writes each entry with setx.
# Environment variables take precedence over config.json, so after running this
# the same config.json can be copied to another machine unchanged - only the
# variables differ per machine.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-roots.ps1                 # preview
#   powershell -ExecutionPolicy Bypass -File scripts/setup-roots.ps1 -Apply          # write
#   powershell -ExecutionPolicy Bypass -File scripts/setup-roots.ps1 -Prefix -Apply  # write as QL_<NAME>
#   powershell -ExecutionPolicy Bypass -File scripts/setup-roots.ps1 -Config D:\tools\QuickLauncher\config.json
#
# -Prefix is for names that would clash with an existing variable: QL_RED also
# satisfies ${RED} and wins over a bare RED.

param(
    [string]$Config,
    [switch]$Apply,
    [switch]$Prefix
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Config) {
    $root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
    $Config = Join-Path $root "config.json"
}

if (-not (Test-Path $Config)) {
    Write-Host "[ERROR] config not found: $Config" -ForegroundColor Red
    exit 1
}

# Read as UTF8 explicitly: config.json may contain non-ASCII entry names.
$json = [System.IO.File]::ReadAllText((Resolve-Path $Config), [System.Text.Encoding]::UTF8)
$cfg = $json | ConvertFrom-Json

if (-not $cfg.roots) {
    Write-Host "config has no 'roots' table - nothing to export." -ForegroundColor Yellow
    Write-Host "Define variables in Settings -> path variables first." -ForegroundColor Yellow
    exit 0
}

$entries = @()
foreach ($p in $cfg.roots.PSObject.Properties) {
    $name = if ($Prefix) { "QL_$($p.Name)" } else { $p.Name }
    $entries += [pscustomobject]@{
        Name     = $name
        Value    = $p.Value
        Existing = [Environment]::GetEnvironmentVariable($name, "User")
        OnDisk   = Test-Path -LiteralPath $p.Value
    }
}

Write-Host "config : $Config"
Write-Host "scope  : user environment variables"
Write-Host "mode   : $(if ($Apply) { 'APPLY' } else { 'preview (pass -Apply to write)' })"
Write-Host ""

foreach ($e in $entries) {
    $notes = @()
    if (-not $e.OnDisk) { $notes += "dir missing" }
    if ($e.Existing -and $e.Existing -ne $e.Value) { $notes += "was: $($e.Existing)" }
    elseif ($e.Existing) { $notes += "already set" }

    $suffix = if ($notes.Count -gt 0) { "  [" + ($notes -join "; ") + "]" } else { "" }
    Write-Host ("  {0,-16} = {1}{2}" -f $e.Name, $e.Value, $suffix)
}

if (-not $Apply) {
    Write-Host ""
    Write-Host "Re-run with -Apply to write these variables." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
foreach ($e in $entries) {
    if ($e.Existing -eq $e.Value) {
        Write-Host "  skip (unchanged): $($e.Name)"
        continue
    }
    [Environment]::SetEnvironmentVariable($e.Name, $e.Value, "User")
    Write-Host "  set: $($e.Name)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Restart QuickLauncher (and any shell) to pick up the changes." -ForegroundColor Green
Write-Host "Variables now win over config.json, so the same config works on other" -ForegroundColor Gray
Write-Host "machines once their own variables are set." -ForegroundColor Gray

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\supabase-mcp-guard"
$installBinDir = Join-Path $installRoot "bin"
$installCmd = Join-Path $installBinDir "supabase-mcp-guard.cmd"
$configDir = Join-Path $env:APPDATA "supabase-mcp-guard"
$configFile = Join-Path $configDir "config.json"
$stateDir = Join-Path $env:LOCALAPPDATA "supabase-mcp-guard"
$logFile = Join-Path $stateDir "audit.log"
$stateFile = Join-Path $stateDir "write_lock.json"

function Require-Command {
    param([string]$Command)
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "缺少命令: $Command"
    }
}

Require-Command node
Require-Command npm
Require-Command powershell

if (-not (Test-Path (Join-Path $repoRoot "package.json")) -or -not (Test-Path (Join-Path $repoRoot "src\cli.mjs"))) {
    throw "仓库文件不完整，请在 supabase-mcp-guard 仓库目录内执行"
}

$tokenSecure = Read-Host "请输入新的 Supabase Access Token" -AsSecureString
$tokenPlain = [System.Net.NetworkCredential]::new("", $tokenSecure).Password
if ([string]::IsNullOrWhiteSpace($tokenPlain)) {
    throw "token 不能为空"
}
if (-not $tokenPlain.StartsWith("sbp_")) {
    throw "token 格式看起来不对，预期以 sbp_ 开头"
}

$projectRefsRaw = Read-Host "请输入允许访问的 project refs（逗号分隔，可留空）"
$projectRefs = @()
if (-not [string]::IsNullOrWhiteSpace($projectRefsRaw)) {
    $projectRefs = $projectRefsRaw.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

New-Item -ItemType Directory -Force -Path $configDir | Out-Null
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if (-not (Get-Module -ListAvailable -Name Microsoft.PowerShell.SecretManagement)) {
    Install-Module Microsoft.PowerShell.SecretManagement -Scope CurrentUser -Force
}
if (-not (Get-Module -ListAvailable -Name Microsoft.PowerShell.SecretStore)) {
    Install-Module Microsoft.PowerShell.SecretStore -Scope CurrentUser -Force
}

Import-Module Microsoft.PowerShell.SecretManagement
Import-Module Microsoft.PowerShell.SecretStore

if (-not (Get-SecretVault -Name SecretStore -ErrorAction SilentlyContinue)) {
    Register-SecretVault -Name SecretStore -ModuleName Microsoft.PowerShell.SecretStore -DefaultVault | Out-Null
}

Set-SecretStoreConfiguration -Authentication None -Interaction None -Confirm:$false | Out-Null
Set-Secret -Name "supabase-mcp-guard" -Vault "SecretStore" -Secret $tokenPlain
$tokenPlain = $null

$config = @{
    secretProvider = @{
        type  = "powershell-secretmanagement"
        name  = "supabase-mcp-guard"
        vault = "SecretStore"
    }
    projectRef           = $null
    readOnly             = $false
    features             = $null
    apiUrl               = $null
    logFile              = $logFile
    stateFile            = $stateFile
    defaultUnlockMinutes = 10
    allowedProjectIds    = $projectRefs
    alwaysBlockedTools   = @("create_project", "pause_project", "restore_project")
}
$config | ConvertTo-Json -Depth 6 | Set-Content -Path $configFile -Encoding UTF8

$tmpInstallDir = Join-Path ([System.IO.Path]::GetTempPath()) ("supabase-mcp-guard-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmpInstallDir | Out-Null

try {
    Copy-Item (Join-Path $repoRoot "package.json") (Join-Path $tmpInstallDir "package.json")
    Copy-Item (Join-Path $repoRoot "src\cli.mjs") (Join-Path $tmpInstallDir "cli.mjs")
    if (Test-Path (Join-Path $repoRoot "package-lock.json")) {
        Copy-Item (Join-Path $repoRoot "package-lock.json") (Join-Path $tmpInstallDir "package-lock.json")
        npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix $tmpInstallDir | Out-Null
    } else {
        npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefix $tmpInstallDir | Out-Null
    }

    New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $installBinDir | Out-Null
    if (Test-Path (Join-Path $installRoot "node_modules")) {
        Remove-Item -Recurse -Force (Join-Path $installRoot "node_modules")
    }

    Copy-Item (Join-Path $tmpInstallDir "package.json") (Join-Path $installRoot "package.json") -Force
    if (Test-Path (Join-Path $tmpInstallDir "package-lock.json")) {
        Copy-Item (Join-Path $tmpInstallDir "package-lock.json") (Join-Path $installRoot "package-lock.json") -Force
    }
    Copy-Item (Join-Path $tmpInstallDir "cli.mjs") (Join-Path $installRoot "cli.mjs") -Force
    Copy-Item (Join-Path $tmpInstallDir "node_modules") (Join-Path $installRoot "node_modules") -Recurse -Force

    $nodeBin = (Get-Command node).Source
    @"
@echo off
setlocal
"$nodeBin" "$installRoot\cli.mjs" %*
"@ | Set-Content -Path $installCmd -Encoding ASCII

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$installBinDir*") {
        $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $installBinDir } else { "$userPath;$installBinDir" }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    }

    & $installCmd --self-test | Out-Null

    Write-Host ""
    Write-Host "安装完成。"
    Write-Host "配置文件: $configFile"
    Write-Host "日志文件: $logFile"
    Write-Host "可执行命令: $installCmd"
    Write-Host "如当前终端未刷新 PATH，请新开一个 PowerShell 窗口。"
    Write-Host "查看状态: supabase-mcp-guard status"
    Write-Host "临时放开写操作: supabase-mcp-guard unlock --minutes 10"
    Write-Host "重新上锁: supabase-mcp-guard lock"
} finally {
    if (Test-Path $tmpInstallDir) {
        Remove-Item -Recurse -Force $tmpInstallDir
    }
}

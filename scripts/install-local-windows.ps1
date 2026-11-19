[CmdletBinding()]
param(
    [string]$InstallDir,
    [switch]$NoLaunch,
    [switch]$SkipTypeCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

$tempConfigPath = $null

try {
    function Resolve-CurrentInstallDir {
        param([string]$ExplicitDir)

        if ($ExplicitDir) {
            return $ExplicitDir.Trim().Trim('"')
        }

        $nsisRegPath = 'HKCU:\Software\yetone\NextAI Translator'
        if (Test-Path $nsisRegPath) {
            $regItem = Get-ItemProperty -Path $nsisRegPath -ErrorAction SilentlyContinue
            $defaultProp = if ($regItem) { $regItem.PSObject.Properties['(default)'] } else { $null }
            if ($defaultProp -and $defaultProp.Value) {
                return ([string]$defaultProp.Value).Trim().Trim('"')
            }
        }

        $uninstallPaths = @(
            'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
        )
        foreach ($path in $uninstallPaths) {
            $entry = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
                Where-Object {
                    $nameProp = $_.PSObject.Properties['DisplayName']
                    $locProp = $_.PSObject.Properties['InstallLocation']
                    $nameProp -and $nameProp.Value -eq 'NextAI Translator' -and $locProp -and $locProp.Value
                } |
                Select-Object -First 1
            if ($entry) {
                return ([string]$entry.InstallLocation).Trim().Trim('"')
            }
        }

        return Join-Path $env:LOCALAPPDATA 'NextAI Translator'
    }

    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    if ((Test-Path (Join-Path $cargoBin 'cargo.exe')) -and -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        $env:Path = "$cargoBin;$env:Path"
    }

    if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -or -not (Get-Command rustc -ErrorAction SilentlyContinue)) {
        throw "未检测到 Rust 工具链 (cargo/rustc)。请先运行 'winget install Rustlang.Rustup' 安装 Rust，重新打开终端后再执行本脚本。"
    }

    $tscCmd = Join-Path $repoRoot 'node_modules\.bin\tsc.cmd'
    $viteCmd = Join-Path $repoRoot 'node_modules\.bin\vite.cmd'
    $tauriCmd = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
    foreach ($tool in @($tscCmd, $viteCmd, $tauriCmd)) {
        if (-not (Test-Path $tool)) {
            throw "缺少前端构建工具: $tool。请先运行 'corepack pnpm install --frozen-lockfile'。"
        }
    }

    $targetDir = Resolve-CurrentInstallDir -ExplicitDir $InstallDir
    $targetExe = Join-Path $targetDir 'app.exe'
    $targetResourcesDir = Join-Path $targetDir 'resources'

    Write-Host "目标安装路径: $targetDir"
    Write-Host '用户配置目录会保持不变:'
    Write-Host "  - $(Join-Path $env:APPDATA 'xyz.yetone.apps.openai-translator')"
    Write-Host "  - $(Join-Path $env:LOCALAPPDATA 'xyz.yetone.apps.openai-translator')"

    if (-not $SkipTypeCheck) {
        Write-Host '[1/4] 运行 TypeScript 类型检查...'
        & $tscCmd --noEmit
        if ($LASTEXITCODE -ne 0) {
            throw 'TypeScript 类型检查失败。'
        }
    }

    Write-Host '[2/4] 构建桌面端前端资源 (dist/tauri)...'
    & $viteCmd build -c vite.config.tauri.ts
    if ($LASTEXITCODE -ne 0) {
        throw '前端资源构建失败。'
    }

    Write-Host '[3/4] 编译 Tauri 桌面端程序...'
    $tempConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) "nextai-local-tauri-$PID.json"
    $localConfigOverride = @{
        bundle  = @{
            createUpdaterArtifacts = $false
        }
        plugins = @{
            updater = @{
                endpoints = @('https://127.0.0.1:0/disabled')
            }
        }
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempConfigPath, ($localConfigOverride | ConvertTo-Json -Depth 5), $utf8NoBom)

    & $tauriCmd build --no-bundle --config $tempConfigPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Tauri 桌面端编译失败。'
    }

    $builtExe = Join-Path $repoRoot 'src-tauri\target\release\app.exe'
    $builtResourcesDir = Join-Path $repoRoot 'src-tauri\resources'
    if (-not (Test-Path $builtExe)) {
        throw "未找到编译产物: $builtExe"
    }

    Write-Host "[4/4] 自动更新到 $targetDir ..."
    $fullTargetExe = [System.IO.Path]::GetFullPath($targetExe)
    $runningProcs = @(
        Get-CimInstance Win32_Process -Filter "Name='app.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $fullTargetExe)
            }
    )
    foreach ($proc in $runningProcs) {
        Write-Host "正在关闭运行中的进程 (PID $($proc.ProcessId))..."
        & taskkill.exe /PID $proc.ProcessId /T /F *> $null
    }

    if ($runningProcs.Count -gt 0) {
        $procIds = @($runningProcs | ForEach-Object { $_.ProcessId })
        for ($i = 0; $i -lt 20; $i++) {
            $stillRunning = Get-Process -Id $procIds -ErrorAction SilentlyContinue
            if (-not $stillRunning) {
                break
            }
            Start-Sleep -Milliseconds 250
        }
    }

    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    New-Item -ItemType Directory -Path $targetResourcesDir -Force | Out-Null

    $copied = $false
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            Copy-Item -Path $builtExe -Destination $targetExe -Force
            $copied = $true
            break
        } catch {
            if ($attempt -eq 10) {
                throw
            }
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $copied) {
        throw "无法更新 $targetExe"
    }
    if (Test-Path $builtResourcesDir) {
        Copy-Item -Path (Join-Path $builtResourcesDir '*') -Destination $targetResourcesDir -Recurse -Force
    }

    Write-Host "更新完成: $targetExe"
    if (-not $NoLaunch) {
        Write-Host '正在重新启动 NextAI Translator...'
        Start-Process -FilePath $targetExe -WorkingDirectory $targetDir
    }
} finally {
    if ($tempConfigPath -and (Test-Path $tempConfigPath)) {
        Remove-Item -Path $tempConfigPath -Force -ErrorAction SilentlyContinue
    }
    Pop-Location
}

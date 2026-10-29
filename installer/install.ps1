# =============================================================================
# 取件箱（dsh-inbox）安装 / 卸载脚本 —— Windows PowerShell 5.1+
#
# 用法（一般不用手敲，双击 install.cmd 即可）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#
# 可选参数：
#   -DshHome    DSH_HOME 目录（默认依次找：参数 > $env:DSH_HOME > %USERPROFILE%\.dsh > %APPDATA%\dsh > %LOCALAPPDATA%\dsh）
#   -Profile    profile 名（默认 desktop；找不到就用 profiles 下唯一带 package.json 的那个）
#   -InstallDir 插件安装位置（默认 %USERPROFILE%\dsh-inbox）
#   -InboxDir   取件箱文件夹（默认 %USERPROFILE%\取件箱）
#   -Json       只输出机器可读的 JSON（给自动化/我调试用）
#
# 做的事：复制插件 → 备份 → 改 profile 的 package.json（dependencies + dsh.profile.bundles）
#        → 改 pnpm-lock.yaml → 建 node_modules 里的 junction → 写 inbox.config.json。
# 卸载只回滚 profile 配置 + 删 junction，不动已装的插件目录和取件箱里的文件。
# =============================================================================
param(
  [string]$DshHome = '',
  [string]$Profile = 'desktop',
  [string]$InstallDir = '',
  [string]$InboxDir = '',
  [switch]$Uninstall,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$PluginName = 'dsh-delivery-box'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$ScriptDir = $PSScriptRoot

# 两种分发形态：
#   repo 模式 = installer\ 的上级目录就是插件包根（GitHub clone 后直接跑）
#   zip  模式 = 安装包根目录（plugin\ 与 install.ps1 同级）
$repoRoot = Split-Path -Parent $ScriptDir
$repoMode = $false
if (Test-Path -LiteralPath (Join-Path $repoRoot 'package.json')) {
  try {
    $maybeManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot 'package.json') | ConvertFrom-Json
    if ($maybeManifest.dsh -and $maybeManifest.dsh.bundle) { $repoMode = $true }
  } catch { }
}

function Write-Info([string]$text) {
  if (-not $Json) { Write-Host $text }
}
function Write-Ok([string]$text) {
  if (-not $Json) { Write-Host $text -ForegroundColor Green }
}
function Fail([string]$message) {
  if ($Json) {
    $payload = [ordered]@{ ok = $false; error = $message }
    [Console]::Out.Write(($payload | ConvertTo-Json -Depth 8))
    [Console]::Out.Write("`n")
  } else {
    Write-Host ''
    Write-Host "✗ 安装失败：$message" -ForegroundColor Red
  }
  exit 1
}

# --- 1. 找 DSH_HOME ---------------------------------------------------------
$homeCandidates = New-Object System.Collections.Generic.List[string]
if ($DshHome -ne '') { $homeCandidates.Add($DshHome) }
if ($env:DSH_HOME) { $homeCandidates.Add($env:DSH_HOME) }
if ($env:USERPROFILE) {
  $homeCandidates.Add((Join-Path $env:USERPROFILE '.dsh'))
}
if ($env:APPDATA) { $homeCandidates.Add((Join-Path $env:APPDATA 'dsh')) }
if ($env:LOCALAPPDATA) { $homeCandidates.Add((Join-Path $env:LOCALAPPDATA 'dsh')) }
# 兼容本机这种把 DSH_HOME 放到别的盘的情况：扫一下 %USERPROFILE% 下一层有没有 *dsh-home*
if ($env:USERPROFILE) {
  Get-ChildItem $env:USERPROFILE -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'dsh.*home' } |
    ForEach-Object { $homeCandidates.Add($_.FullName) }
}

$resolvedHome = ''
foreach ($candidate in $homeCandidates) {
  if ($candidate -ne '' -and (Test-Path (Join-Path $candidate 'profiles'))) {
    $resolvedHome = (Resolve-Path $candidate).Path
    break
  }
}
if ($resolvedHome -eq '') {
  Fail "找不到 DSH_HOME（没有发现 profiles 目录）。请用 -DshHome 指定，例如：`n  powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome `"C:\Users\你\.dsh`"`n（在你的 DSH 里问一句「echo %DSH_HOME%」或看它的安装位置也能知道）"
}

# --- 2. 找 profile 目录 -----------------------------------------------------
$profilesRoot = Join-Path $resolvedHome 'profiles'
$profileDir = Join-Path $profilesRoot $Profile
if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  $candidates = @(Get-ChildItem $profilesRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'package.json') })
  if ($candidates.Count -eq 1) {
    $profileDir = $candidates[0].FullName
    Write-Info "· 没用默认的 desktop，改用 profiles 下唯一的：$profileDir"
  } else {
    $names = ($candidates | ForEach-Object { $_.Name }) -join ', '
    Fail "找不到 profile `"$Profile`"。$profilesRoot 下可用的 profile：$names`n请用 -Profile <名字> 指定。"
  }
}
$profileDir = (Resolve-Path $profileDir).Path
$pkgPath = Join-Path $profileDir 'package.json'
$lockPath = Join-Path $profileDir 'pnpm-lock.yaml'
Write-Info "· DSH_HOME：$resolvedHome"
Write-Info "· profile：$profileDir"

# --- 3. 位置参数 ------------------------------------------------------------
if ($repoMode) {
  $InstallDir = [System.IO.Path]::GetFullPath($repoRoot)
  $pluginDir = $repoRoot
  $toolsDir = Join-Path $repoRoot 'tools'
} else {
  if ($InstallDir -eq '') {
    $InstallDir = Join-Path $env:USERPROFILE 'dsh-delivery-box'
  }
  $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
  $pluginDir = Join-Path $InstallDir 'plugin'
  $toolsDir = Join-Path $InstallDir 'tools'
}
if ($InboxDir -eq '') {
  $InboxDir = Join-Path $env:USERPROFILE '取件箱'
}
$InboxDir = [System.IO.Path]::GetFullPath($InboxDir)

# 插件源码位置：repo 模式用仓库根，zip 模式用同级 plugin\ 目录
if ($repoMode) {
  $sourcePlugin = $repoRoot
  $sourceTools = Join-Path $repoRoot 'tools'
  Write-Info "· 仓库模式：直接使用 $repoRoot（不复制）"
} else {
  $sourcePlugin = Join-Path $ScriptDir 'plugin'
  $sourceTools = Join-Path $ScriptDir 'tools'
}
if (-not (Test-Path (Join-Path $sourcePlugin 'package.json'))) {
  Fail "安装包不完整：找不到 $sourcePlugin\package.json（repo 模式请在仓库根目录找 package.json；zip 模式请重新解压完整包）"
}

function Escape-Json([string]$value) {
  return ($value | ConvertTo-Json -Compress)
}

# 相对路径（Windows PowerShell 5.1 没有 [IO.Path]::GetRelativePath，用 Uri 算）
function Get-RelativePath([string]$fromDir, [string]$toPath) {
  $fromFull = [System.IO.Path]::GetFullPath($fromDir).TrimEnd('\') + '\'
  $fromUri = New-Object System.Uri($fromFull)
  $toUri = New-Object System.Uri([System.IO.Path]::GetFullPath($toPath))
  $rel = $fromUri.MakeRelativeUri($toUri).ToString()
  return ([System.Uri]::UnescapeDataString($rel)).Replace('/', '\')
}

# 找一台机器上能用的 node.exe：PATH > DSH 自带的运行时
function Find-NodeExe {
  $fromPath = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -ne $fromPath -and $fromPath.Source -and (Test-Path -LiteralPath $fromPath.Source)) {
    return $fromPath.Source
  }
  $uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($root in $uninstallRoots) {
    $entries = Get-ItemProperty $root -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match 'DeepSeek Harness' -and $_.InstallLocation }
    foreach ($entry in $entries) {
      $candidate = Join-Path $entry.InstallLocation 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  return ''
}

# 写 .cmd 包装（用系统 ANSI 编码，中文用户名/路径在 cmd 里才不会乱）
function Write-CmdWrapper([string]$path, [string]$nodeExe, [string]$scriptName) {
  $body = "@echo off`r`n`"$nodeExe`" `"%~dp0$scriptName`" %*`r`n"
  [System.IO.File]::WriteAllText($path, $body, [System.Text.Encoding]::Default)
}

function Remove-LinkSafe([string]$path) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $false }
  if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    Fail "目标已存在且不是链接（是个真实目录），不敢动：$path`n请手动改名/删除后再装。"
  }
  $null = & cmd.exe /c ('rmdir "{0}"' -f $path)
  if (Test-Path -LiteralPath $path) { Fail "删不掉旧链接：$path" }
  return $true
}

# --- 4. 卸载分支 ------------------------------------------------------------
if ($Uninstall) {
  $removed = [ordered]@{
    packageEntry = $false
    bundleEntry = $false
    lockEntry = $false
    junction = $false
  }

  # 4.1 package.json
  if (Test-Path $pkgPath) {
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $pkgPath | ConvertFrom-Json
    if ($manifest.PSObject.Properties.Name -contains 'dependencies' -and
      $manifest.dependencies.PSObject.Properties.Name -contains $PluginName) {
      $manifest.dependencies.PSObject.Properties.Remove($PluginName)
      $removed.packageEntry = $true
    }
    if ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles) {
      $after = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne $PluginName })
      if ($after.Count -ne @($manifest.dsh.profile.bundles).Count) {
        $manifest.dsh.profile.bundles = $after
        $removed.bundleEntry = $true
      }
    }
    if ($removed.packageEntry -or $removed.bundleEntry) {
      Copy-Item -LiteralPath $pkgPath -Destination ("$pkgPath.bak-{0}-dsh-inbox-uninstall" -f (Get-Date -Format 'yyyyMMddHHmmss')) -Force
      $jsonText = $manifest | ConvertTo-Json -Depth 32
      [System.IO.File]::WriteAllText($pkgPath, $jsonText + "`n", $Utf8NoBom)
    }
  }

  # 4.2 pnpm-lock.yaml
  if (Test-Path $lockPath) {
    $lines = [System.IO.File]::ReadAllLines($lockPath)
    $kept = New-Object System.Collections.Generic.List[string]
    $skipping = $false
    foreach ($line in $lines) {
      if ($line -match ('^\s{6}' + [regex]::Escape($PluginName) + ':\s*$')) { $skipping = $true; continue }
      if ($skipping) {
        if ($line -match '^\s{8,}\S') { continue }  # 属于 dsh-inbox 的子字段
        $skipping = $false
      }
      $kept.Add($line)
    }
    if ($kept.Count -ne $lines.Count) {
      Copy-Item -LiteralPath $lockPath -Destination ("$lockPath.bak-{0}-dsh-inbox-uninstall" -f (Get-Date -Format 'yyyyMMddHHmmss')) -Force
      [System.IO.File]::WriteAllLines($lockPath, [string[]]$kept.ToArray(), $Utf8NoBom)
      $removed.lockEntry = $true
    }
  }

  # 4.3 junction
  $nodeModules = Join-Path $profileDir 'node_modules'
  $link = Join-Path $nodeModules $PluginName
  if (Test-Path -LiteralPath $link) {
    $removed.junction = Remove-LinkSafe $link
  }

  if ($Json) {
    $result = [ordered]@{ ok = $true; action = 'uninstall'; dshHome = $resolvedHome; profile = $profileDir; removed = $removed }
    [Console]::Out.Write(($result | ConvertTo-Json -Depth 8))
    [Console]::Out.Write("`n")
  } else {
    Write-Host ''
    Write-Ok '✓ 已卸载取件箱插件（只回滚了 profile 配置，插件目录和取件箱里的文件都保留着）'
    Write-Host ("  改了 package.json：{0} / bundles：{1} / lock：{2} / junction：{3}" -f $removed.packageEntry, $removed.bundleEntry, $removed.lockEntry, $removed.junction)
    Write-Host '  完全重启 DSH 后，侧栏的「取件箱」图标就会消失。'
    Write-Host ("  想彻底删干净：删掉 {0} 和 {1}" -f $InstallDir, $InboxDir)
  }
  exit 0
}

# --- 5. 安装分支 ------------------------------------------------------------
if (-not $repoMode) {
  Write-Info '· 复制插件文件…'
  New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  Copy-Item -Path (Join-Path $sourcePlugin '*') -Destination $pluginDir -Recurse -Force
  if (Test-Path $sourceTools) {
    Copy-Item -Path (Join-Path $sourceTools '*') -Destination $toolsDir -Recurse -Force
  }
}

# 5.0 找 node，生成「投递.cmd / 建桌面快捷方式.cmd」（机器相关的 node 路径写死在包装里）
Write-Info '· 找 node 运行时…'
$nodeExe = Find-NodeExe
$wrapperPath = Join-Path $toolsDir '投递.cmd'
$shortcutWrapperPath = Join-Path $toolsDir '建桌面快捷方式.cmd'
if ($nodeExe -ne '') {
  Write-CmdWrapper $wrapperPath $nodeExe 'inbox.mjs'
  Write-CmdWrapper $shortcutWrapperPath $nodeExe 'setup-shortcuts.mjs'
  Write-Info ("· 找到 node：{0}" -f $nodeExe)
} else {
  Write-Info '· ⚠ 没找到 node.exe（PATH 和 DSH 自带运行时里都没有），投递改用文档里的「手动 / HTTP」方式'
}

# 5.1 写 inbox.config.json（取件箱文件夹位置）
New-Item -ItemType Directory -Force -Path $InboxDir | Out-Null
$configPath = Join-Path $pluginDir 'inbox.config.json'
$configJson = "{`n  `"inboxDir`": " + (Escape-Json $InboxDir) + "`n}`n"
[System.IO.File]::WriteAllText($configPath, $configJson, $Utf8NoBom)
Write-Info ("· 取件箱文件夹：{0}" -f $InboxDir)

# 5.2 备份
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$null = Copy-Item -LiteralPath $pkgPath -Destination ("$pkgPath.bak-$stamp-dsh-inbox") -Force
if (Test-Path $lockPath) {
  $null = Copy-Item -LiteralPath $lockPath -Destination ("$lockPath.bak-$stamp-dsh-inbox") -Force
}

# 5.3 改 package.json
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $pkgPath | ConvertFrom-Json
if (-not ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles)) {
  Fail "这个 profile 的 package.json 里没有 dsh.profile.bundles，看起来不是 DSH 的 Web/desktop profile。`n（选错 profile 了？用 -Profile 指定正确的那个）"
}
$pluginSpec = 'link:' + ($pluginDir -replace '\\', '/')
if (-not ($manifest.PSObject.Properties.Name -contains 'dependencies') -or $null -eq $manifest.dependencies) {
  $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
$manifest.dependencies | Add-Member -NotePropertyName $PluginName -NotePropertyValue $pluginSpec -Force
$bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne $PluginName })
$manifest.dsh.profile.bundles = @($bundles + $PluginName)
$pkgJson = $manifest | ConvertTo-Json -Depth 32
[System.IO.File]::WriteAllText($pkgPath, $pkgJson + "`n", $Utf8NoBom)
Write-Info '· 已更新 profile 的 package.json（dependencies + dsh.profile.bundles）'

# 5.4 改 pnpm-lock.yaml（改失败不致命，只警告）
$lockStatus = 'skipped'
if (Test-Path $lockPath) {
  try {
    $lines = [System.IO.File]::ReadAllLines($lockPath)
    $kept = New-Object System.Collections.Generic.List[string]
    $skipping = $false
    foreach ($line in $lines) {
      if ($line -match ('^\s{6}' + [regex]::Escape($PluginName) + ':\s*$')) { $skipping = $true; continue }
      if ($skipping) {
        if ($line -match '^\s{8,}\S') { continue }
        $skipping = $false
      }
      $kept.Add($line)
    }

    # 找 importers -> "." -> dependencies
    $importerIdx = -1
    for ($i = 0; $i -lt $kept.Count; $i++) {
      if ($kept[$i] -match '^importers:\s*$') { $importerIdx = $i; break }
    }
    $dotIdx = -1
    if ($importerIdx -ge 0) {
      for ($i = $importerIdx + 1; $i -lt $kept.Count; $i++) {
        if ($kept[$i] -match '^\s{2}\.\s*:\s*$') { $dotIdx = $i; break }
        if ($kept[$i] -match '^\S') { break }
      }
    }
    $depIdx = -1
    if ($dotIdx -ge 0) {
      for ($i = $dotIdx + 1; $i -lt $kept.Count; $i++) {
        if ($kept[$i] -match '^\s{4}dependencies:\s*$') { $depIdx = $i; break }
        if ($kept[$i] -match '^\s{2}[^\s].*:\s*$') { break }
      }
    }
    if ($depIdx -ge 0) {
      $rel = (Get-RelativePath $profileDir $pluginDir) -replace '\\', '/'
      $block = @(
        ('      {0}:' -f $PluginName),
        ('        specifier: {0}' -f $pluginSpec),
        ('        version: link:{0}' -f $rel)
      )
      $newLines = New-Object System.Collections.Generic.List[string]
      for ($i = 0; $i -lt $kept.Count; $i++) {
        $newLines.Add($kept[$i])
        if ($i -eq $depIdx) { foreach ($b in $block) { $newLines.Add($b) } }
      }
      [System.IO.File]::WriteAllLines($lockPath, [string[]]$newLines.ToArray(), $Utf8NoBom)
      $lockStatus = 'patched'
      Write-Info '· 已更新 pnpm-lock.yaml'
    } else {
      $lockStatus = 'skipped-no-importer'
    }
  } catch {
    $lockStatus = 'failed: ' + $_.Exception.Message
  }
} else {
  $lockStatus = 'skipped-no-lockfile'
}

# 5.5 建 junction
$nodeModules = Join-Path $profileDir 'node_modules'
New-Item -ItemType Directory -Force -Path $nodeModules | Out-Null
$link = Join-Path $nodeModules $PluginName
if (Test-Path -LiteralPath $link) { $null = Remove-LinkSafe $link }
New-Item -ItemType Junction -Path $link -Target $pluginDir | Out-Null
Write-Info ("· 已在 profile 的 node_modules 建好链接：{0} -> {1}" -f $link, $pluginDir)

# 5.6 自检
$checks = [ordered]@{
  pluginFiles = (Test-Path (Join-Path $pluginDir 'index.js')) -and (Test-Path (Join-Path $pluginDir 'client.js'))
  configFile = Test-Path $configPath
  inboxDir = Test-Path $InboxDir
  manifestDep = $false
  manifestBundle = $false
  lockfile = $lockStatus
  junction = $false
  nodeExe = $nodeExe
  deliverWrapper = (Test-Path $wrapperPath)
}
$readBack = Get-Content -Raw -Encoding UTF8 -LiteralPath $pkgPath | ConvertFrom-Json
if ($readBack.PSObject.Properties.Name -contains 'dependencies' -and
  $readBack.dependencies.PSObject.Properties.Name -contains $PluginName) { $checks.manifestDep = $true }
if ($readBack.dsh -and $readBack.dsh.profile -and (@($readBack.dsh.profile.bundles) -contains $PluginName)) { $checks.manifestBundle = $true }
$linkItem = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
if ($null -ne $linkItem -and ($linkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { $checks.junction = $true }

if (-not ($checks.pluginFiles -and $checks.configFile -and $checks.inboxDir -and $checks.manifestDep -and $checks.manifestBundle -and $checks.junction)) {
  Fail ("装完了但自检没过：" + ($checks | ConvertTo-Json -Compress))
}

$deliverCommand = if ($nodeExe -ne '') {
  ('"' + (Join-Path $toolsDir '投递.cmd') + '" add <文件> --origin "<对话或项目>" --clip --json')
} else {
  ('node "' + (Join-Path $toolsDir 'inbox.mjs') + '" add <文件> --origin "<对话或项目>" --clip --json')
}

if ($Json) {
  $result = [ordered]@{
    ok = $true
    action = 'install'
    dshHome = $resolvedHome
    profile = $profileDir
    installDir = $InstallDir
    pluginDir = $pluginDir
    inboxDir = $InboxDir
    nodeExe = $nodeExe
    deliverCommand = $deliverCommand
    checks = $checks
    nextSteps = @('完全重启 DSH（关掉再开，不是最小化）', '左侧栏出现「取件箱」图标', '让 AI 用 tools\投递.cmd 投递交付物')
  }
  [Console]::Out.Write(($result | ConvertTo-Json -Depth 10))
  [Console]::Out.Write("`n")
  exit 0
}

Write-Host ''
Write-Ok '✓ 取件箱装好了'
Write-Host ''
Write-Host '接下来：'
Write-Host '  1) 完全重启 DSH（关掉再开，不是最小化）。'
Write-Host '  2) 左侧栏「任务看板」下面会出现「取件箱」图标，点开就能用。'
Write-Host ("  3) 取件箱文件夹：{0}" -f $InboxDir)
Write-Host '  4) 让 AI 把交付物投进来（把下面这行发给你的 AI，或写进它的 AGENTS.md）：'
Write-Host ('     ' + $deliverCommand)
if ($nodeExe -eq '') {
  Write-Host '     （没找到 node，这行要先把 node 换成本机可用的 node.exe 路径；见「交付文档.md」）'
}
Write-Host ''
Write-Host ('桌面快捷方式：双击 ' + (Join-Path $toolsDir '建桌面快捷方式.cmd'))
Write-Host '卸载：双击 uninstall.cmd（或 powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall）'
Write-Host '详细说明见同目录「交付文档.md」'
exit 0

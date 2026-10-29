#!/usr/bin/env node
/**
 * 取件箱桌面入口 —— 一次性（幂等）安装脚本。
 *
 * 做两件事：
 *   1. 在桌面创建快捷方式「取件箱.lnk」→ 目标 C:\Windows\explorer.exe，参数 "用户主目录\取件箱"
 *   2. 把这个文件夹固定到资源管理器「快速访问」（Shell.Application 的 pintohome 动词）
 *
 * 结果以 JSON 打印；重复执行是幂等的（快捷方式重写为同一内容，已固定的不再重复固定）。
 * 零依赖：Node 内置模块 + 系统 PowerShell（-NoProfile -STA -EncodedCommand）。
 *
 * 用法：<E:\node.exe> setup-shortcuts.mjs
 * 取件箱根目录：用户主目录\取件箱（环境变量 DSH_INBOX_DIR 可覆盖；不存在自动创建）。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 取件箱根目录：环境变量 DSH_INBOX_DIR > 插件目录 inbox.config.json > 用户主目录\取件箱。
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
// 两种安装布局都认：zip 包（tools/ 与 plugin/ 同级）和 仓库/npm 包（tools/ 就在包根下）。
const CONFIG_CANDIDATES = [
  path.resolve(SCRIPT_DIR, '..', 'plugin', 'inbox.config.json'),
  path.resolve(SCRIPT_DIR, '..', 'inbox.config.json'),
]
const FALLBACK_INBOX_ROOT = path.join(os.homedir(), '取件箱')

function readConfiguredInboxRoot() {
  for (const configFile of CONFIG_CANDIDATES) {
    try {
      const data = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      if (data !== null && typeof data === 'object' && typeof data.inboxDir === 'string' && data.inboxDir.trim() !== '') {
        return data.inboxDir.trim()
      }
    } catch { /* 试下一个 */ }
  }
  return ''
}

const ENV_INBOX_ROOT = typeof process.env.DSH_INBOX_DIR === 'string' ? process.env.DSH_INBOX_DIR.trim() : ''
const CONFIG_INBOX_ROOT = readConfiguredInboxRoot()
const INBOX_ROOT = path.resolve(
  ENV_INBOX_ROOT !== '' ? ENV_INBOX_ROOT : (CONFIG_INBOX_ROOT !== '' ? CONFIG_INBOX_ROOT : FALLBACK_INBOX_ROOT),
)

const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || process.env.windir || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

const SHORTCUT_NAME = '取件箱.lnk'
const RESULT_MARKER = '@@RESULT@@'

/** PowerShell 单引号字符串转义：' -> '' */
function psQuote(value) {
  return String(value).replace(/'/g, "''")
}

/** 用 -EncodedCommand 跑 PowerShell（脚本内中文/引号不用转义）。 */
function runPowerShell(script, timeoutMs = 60000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = spawnSync(
    POWERSHELL_EXE,
    ['-NoProfile', '-STA', '-EncodedCommand', encoded],
    { windowsHide: true, encoding: 'utf8', timeout: timeoutMs },
  )
  return {
    error: result.error ? result.error.message : null,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  }
}

/**
 * PowerShell 端输出 '@@RESULT@@<base64(UTF-8 JSON)>'。
 * 走 base64 是为了绕开 PowerShell 5.1 控制台输出编码（OEM 936）可能把中文打成乱码的问题。
 */
function parsePayload(stdout) {
  const lines = stdout.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line.startsWith(RESULT_MARKER)) continue
    try {
      const bytes = Buffer.from(line.slice(RESULT_MARKER.length), 'base64')
      return JSON.parse(bytes.toString('utf8'))
    } catch {
      return null
    }
  }
  return null
}

function buildScript() {
  const inbox = psQuote(INBOX_ROOT)
  const shortcutName = psQuote(SHORTCUT_NAME)

  // 注意：这段脚本会被包进 String.raw，反斜杠按字面保留。
  return String.raw`$ErrorActionPreference = 'Stop'
$inbox = '${inbox}'
$shortcutName = '${shortcutName}'
$result = [ordered]@{
  inbox = $inbox
  desktop = $null
  lnk = $null
  shortcutExistedBefore = $false
  shortcutExists = $false
  shortcutTargetPath = $null
  shortcutArguments = $null
  pinnedBefore = $false
  pinInvoked = $false
  pinnedAfter = $false
  quickAccessEntries = @()
  errors = @()
}

try {
  if (-not (Test-Path -LiteralPath $inbox -PathType Container)) {
    New-Item -ItemType Directory -Force -Path $inbox | Out-Null
  }
  $desktop = [Environment]::GetFolderPath('Desktop')
  $result.desktop = $desktop
  $lnk = Join-Path $desktop $shortcutName
  $result.lnk = $lnk
  $result.shortcutExistedBefore = Test-Path -LiteralPath $lnk

  $wsh = New-Object -ComObject WScript.Shell
  $sc = $wsh.CreateShortcut($lnk)
  $sc.TargetPath = Join-Path $env:SystemRoot 'explorer.exe'
  $sc.Arguments = '"' + $inbox + '"'
  $sc.WorkingDirectory = $inbox
  $sc.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',3'
  $sc.Description = '取件箱 (DSH 交付物)'
  $sc.WindowStyle = 1
  $sc.Save()

  $result.shortcutExists = Test-Path -LiteralPath $lnk
  $readBack = $wsh.CreateShortcut($lnk)
  $result.shortcutTargetPath = $readBack.TargetPath
  $result.shortcutArguments = $readBack.Arguments
} catch {
  $result.errors += ('shortcut: ' + $_.Exception.Message)
}

try {
  $qaGuid = 'shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}'
  $shell = New-Object -ComObject Shell.Application
  $qa = $shell.Namespace($qaGuid)
  if ($qa) {
    foreach ($entry in $qa.Items()) {
      $entryPath = $null
      try { $entryPath = $entry.Path } catch {}
      $result.quickAccessEntries += [ordered]@{ name = $entry.Name; path = $entryPath }
      if ($entryPath -and ([string]::Equals($entryPath.TrimEnd('\'), $inbox.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase))) {
        $result.pinnedBefore = $true
      }
    }
  }
  if (-not $result.pinnedBefore) {
    $folder = $shell.Namespace($inbox)
    if ($folder) {
      $folder.Self.InvokeVerb('pintohome')
      $result.pinInvoked = $true
    } else {
      $result.errors += ('quickaccess: 无法为 ' + $inbox + ' 取得 Shell 文件夹对象')
    }
  }

  $pinned = $result.pinnedBefore
  for ($attempt = 0; $attempt -lt 10 -and -not $pinned; $attempt += 1) {
    Start-Sleep -Milliseconds 400
    $shell2 = New-Object -ComObject Shell.Application
    $qa2 = $shell2.Namespace($qaGuid)
    if ($qa2) {
      $entries = @()
      foreach ($entry in $qa2.Items()) {
        $entryPath = $null
        try { $entryPath = $entry.Path } catch {}
        $entries += [ordered]@{ name = $entry.Name; path = $entryPath }
        if ($entryPath -and ([string]::Equals($entryPath.TrimEnd('\'), $inbox.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase))) {
          $pinned = $true
        }
      }
      $result.quickAccessEntries = $entries
    }
  }
  $result.pinnedAfter = $pinned
} catch {
  $result.errors += ('quickaccess: ' + $_.Exception.Message)
}

$json = $result | ConvertTo-Json -Compress -Depth 6
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
Write-Output ('${RESULT_MARKER}' + $b64)`
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      [
        '取件箱桌面入口安装（幂等）',
        '',
        '用法：',
        '  node setup-shortcuts.mjs',
        '',
        `  取件箱根目录：${INBOX_ROOT}（环境变量 DSH_INBOX_DIR 可覆盖）`,
        '  桌面快捷方式名：取件箱.lnk → explorer.exe "取件箱路径"',
        '  并把该文件夹固定到资源管理器「快速访问」。',
        '',
      ].join('\n'),
    )
    return 0
  }

  if (!fs.existsSync(INBOX_ROOT)) fs.mkdirSync(INBOX_ROOT, { recursive: true })

  const ps = runPowerShell(buildScript())
  const payload = parsePayload(ps.stdout)
  const errors = []
  if (ps.error) errors.push(`无法调用 PowerShell：${ps.error}`)
  if (payload === null) {
    const detail = ps.stderr.trim() || ps.stdout.trim() || '（无输出）'
    errors.push(`PowerShell 未返回可解析结果（status=${ps.status}）：${detail}`)
  }
  if (payload && Array.isArray(payload.errors)) errors.push(...payload.errors)

  const shortcutPath = (payload && payload.lnk) || path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', SHORTCUT_NAME)

  // Node 侧再独立验一遍 .lnk 真的落盘了（不能只信 PowerShell 自报）。
  let shortcutFile = null
  try {
    const stat = fs.statSync(shortcutPath)
    shortcutFile = { size: stat.size, mtime: Math.round(stat.mtimeMs), isFile: stat.isFile() }
  } catch {
    shortcutFile = null
  }

  const shortcutExists = shortcutFile !== null && shortcutFile.isFile && shortcutFile.size > 0
  const pinned = !!(payload && payload.pinnedAfter === true)
  const ok = shortcutExists && pinned && !ps.error

  const quickAccessEntries = payload && Array.isArray(payload.quickAccessEntries)
    ? payload.quickAccessEntries.slice(0, 40)
    : []

  const result = {
    ok,
    inbox: INBOX_ROOT,
    desktop: payload ? payload.desktop : null,
    shortcut: {
      path: shortcutPath,
      name: SHORTCUT_NAME,
      targetPath: payload ? payload.shortcutTargetPath : null,
      arguments: payload ? payload.shortcutArguments : null,
      existedBefore: payload ? payload.shortcutExistedBefore === true : false,
      created: payload ? payload.shortcutExistedBefore === false && shortcutExists : false,
      updated: payload ? payload.shortcutExistedBefore === true && shortcutExists : false,
      exists: shortcutExists,
      size: shortcutFile ? shortcutFile.size : null,
    },
    quickAccess: {
      pinned,
      pinnedBefore: payload ? payload.pinnedBefore === true : false,
      pinInvoked: payload ? payload.pinInvoked === true : false,
      verifiedBy: 'Shell.Application Namespace("shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}")',
      entries: quickAccessEntries,
    },
    errors,
    powershell: {
      status: ps.status,
      stderr: ps.stderr.trim() || null,
      parsed: payload !== null,
    },
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!ok) {
    process.stderr.write(`安装未完全成功：${errors.join('；') || '请检查上面的 JSON'}\n`)
    return 1
  }
  return 0
}

try {
  process.exit(main())
} catch (error) {
  process.stderr.write(`错误：${error && error.message ? error.message : String(error)}\n`)
  process.exit(1)
}

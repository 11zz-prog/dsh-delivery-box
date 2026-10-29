#!/usr/bin/env node
/**
 * 取件箱（Inbox）命令行工具 —— 零依赖。
 *
 * 只使用 Node 内置模块 + 系统 PowerShell（powershell.exe -NoProfile -STA -EncodedCommand）
 * 完成：文件进取件箱、列清单、复制到剪贴板（图片走图像剪贴板 / 其它走文件剪贴板）、
 *       在资源管理器中选中、打开取件箱文件夹。
 *
 * 用法：
 *   node inbox.mjs add <文件> [--name "新名字"] [--clip] [--reveal] [--json]
 *   node inbox.mjs list [--json]
 *   node inbox.mjs copy [name|latest] [--mode auto|image|file] [--json]
 *   node inbox.mjs reveal [name|latest] [--json]
 *   node inbox.mjs open [--json]
 *
 * 取件箱根目录：用户主目录\取件箱（环境变量 DSH_INBOX_DIR 可覆盖；不存在自动创建）。
 * 位置无关：从任何 cwd 调用都可用；输出文件一律 UTF-8 无 BOM。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// 常量与路径
// ---------------------------------------------------------------------------

// 取件箱根目录，优先级：环境变量 DSH_INBOX_DIR > 插件目录里的 inbox.config.json > 用户主目录\取件箱。
// 安装器（install-inbox.mjs）会写 inbox.config.json；绝对路径，所以从任何 cwd 调用结果都一样。
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

const MAX_LIST_ITEMS = 200
const CLIPBOARD_MODES = ['auto', 'image', 'file']

/** 扩展名 -> kind（与规格.md 的类型表严格一致） */
const KIND_BY_EXT = new Map(
  Object.entries({
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'],
    video: ['mp4', 'webm', 'mov', 'm4v', 'mkv'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
    pdf: ['pdf'],
    text: ['txt', 'md', 'json', 'js', 'ts', 'css', 'html', 'htm', 'csv', 'log', 'yml', 'yaml', 'py', 'ps1', 'bat', 'cmd', 'sql', 'xml'],
    doc: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
    archive: ['zip', 'rar', '7z'],
  }).flatMap(([kind, exts]) => exts.map((ext) => [ext, kind])),
)

// ---------------------------------------------------------------------------
// 错误类型与通用工具
// ---------------------------------------------------------------------------

class CliError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

function fail(code, message) {
  throw new CliError(code, message)
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 剪贴板偶尔会被别的进程占用，失败重试几次。 */
function withRetry(fn, attempts = 3) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      return fn()
    } catch (error) {
      lastError = error
      if (i < attempts - 1) sleepSync(250)
    }
  }
  throw lastError
}

function kindOf(name) {
  const ext = path.extname(name).slice(1).toLowerCase()
  return { kind: KIND_BY_EXT.get(ext) || 'other', ext }
}

function itemOfName(name, stat, meta) {
  const { kind, ext } = kindOf(name)
  const item = {
    name,
    kind,
    ext,
    size: stat.size,
    mtime: stat.mtimeMs,
    url: `api/inbox/file?name=${encodeURIComponent(name)}`,
  }
  if (meta !== null && meta !== undefined) {
    if (typeof meta.origin === 'string' && meta.origin !== '') item.origin = meta.origin
    if (typeof meta.project === 'string' && meta.project !== '') item.project = meta.project
    if (typeof meta.sessionId === 'string' && meta.sessionId !== '') item.sessionId = meta.sessionId
  }
  return item
}

// ---------------------------------------------------------------------------
// 来源标注（哪个对话 / 哪个项目产出的）—— 存在取件箱里的隐藏文件 .origins.json
// ---------------------------------------------------------------------------

const ORIGINS_FILE = path.join(INBOX_ROOT, '.origins.json')
const ORIGINS_VERSION = 1

function readOrigins() {
  try {
    const data = JSON.parse(fs.readFileSync(ORIGINS_FILE, 'utf8'))
    if (data !== null && typeof data === 'object' && data.items !== null && typeof data.items === 'object') return data.items
  } catch { /* 没有 / 坏了就当空表 */ }
  return {}
}

function writeOrigins(items) {
  const payload = { version: ORIGINS_VERSION, items }
  fs.writeFileSync(ORIGINS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/** 给一件物品写来源标注（origin=对话/会话标题，project=项目目录名）。 */
function setOriginMeta(name, meta) {
  const items = readOrigins()
  const entry = { ...(items[name] || {}) }
  if (meta.origin !== undefined && meta.origin !== null) entry.origin = String(meta.origin)
  if (meta.project !== undefined && meta.project !== null) entry.project = String(meta.project)
  if (meta.sessionId !== undefined && meta.sessionId !== null) entry.sessionId = String(meta.sessionId)
  entry.updatedAt = new Date().toISOString()
  items[name] = entry
  writeOrigins(items)
  return entry
}

/** 从源文件路径猜项目名（路径里含 projects\<项目>\ 时取那个 <项目>）。 */
function inferProject(sourcePath) {
  const resolved = path.resolve(sourcePath)
  const marker = `${path.sep}projects${path.sep}`
  const at = resolved.indexOf(marker)
  if (at >= 0) {
    const rest = resolved.slice(at + marker.length)
    const first = rest.split(path.sep)[0]
    if (first) return first
  }
  return null
}


function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function humanTime(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function printJsonPretty(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// 取件箱目录与列表
// ---------------------------------------------------------------------------

/** 确保取件箱根目录存在（不存在就创建）。 */
function ensureInboxRoot() {
  if (!fs.existsSync(INBOX_ROOT)) {
    fs.mkdirSync(INBOX_ROOT, { recursive: true })
    return
  }
  const stat = fs.statSync(INBOX_ROOT)
  if (!stat.isDirectory()) fail('INBOX_NOT_DIR', `取件箱路径不是目录：${INBOX_ROOT}`)
}

/** 按规格扫描取件箱：只要普通文件、跳过隐藏文件与 desktop.ini、按 mtime 倒序、最多 200 条。 */
function listItems() {
  ensureInboxRoot()
  const origins = readOrigins()
  const items = []
  for (const entry of fs.readdirSync(INBOX_ROOT, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const { name } = entry
    if (name.startsWith('.')) continue
    if (name.toLowerCase() === 'desktop.ini') continue
    let stat
    try {
      stat = fs.statSync(path.join(INBOX_ROOT, name))
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    items.push(itemOfName(name, stat, origins[name]))
  }
  items.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
  return items.slice(0, MAX_LIST_ITEMS)
}

/** 只接受单层文件名（拒绝路径分隔符、冒号、..），并确认解析后仍在取件箱根下。 */
function assertSafeName(name) {
  if (typeof name !== 'string' || name.trim() === '') fail('BAD_ARGS', '文件名不能为空')
  if (name.includes('\\') || name.includes('/') || name.includes(':') || name.includes('..')) {
    fail('BAD_NAME', `非法文件名（只接受单层文件名，不能含 \\ / : ..）：${name}`)
  }
  const abs = path.resolve(INBOX_ROOT, name)
  if (!abs.startsWith(INBOX_ROOT + path.sep)) {
    fail('BAD_NAME', `文件名越界（不在取件箱内）：${name}`)
  }
  return abs
}

/** 取一件：名字或 'latest'（最新一件，按 mtime）。 */
function getItem(nameOrLatest) {
  ensureInboxRoot()
  const raw = nameOrLatest === undefined || nameOrLatest === null ? 'latest' : String(nameOrLatest)
  const key = raw.trim()
  let name
  if (key === '' || key.toLowerCase() === 'latest') {
    const items = listItems()
    if (items.length === 0) fail('EMPTY', `取件箱是空的：${INBOX_ROOT}`)
    name = items[0].name
  } else {
    name = key
  }
  const abs = assertSafeName(name)
  let stat
  try {
    stat = fs.statSync(abs)
  } catch {
    fail('NOT_FOUND', `取件箱里没有这个文件：${name}`)
  }
  if (!stat.isFile()) fail('NOT_FILE', `不是普通文件：${name}`)
  return { ...itemOfName(name, stat, readOrigins()[name]), path: abs }
}

/** 重名规则：base-2.ext、base-3.ext … */
function uniqueTargetName(desiredName) {
  const ext = path.extname(desiredName)
  const base = ext ? desiredName.slice(0, -ext.length) : desiredName
  let candidate = desiredName
  for (let n = 2; fs.existsSync(path.join(INBOX_ROOT, candidate)); n += 1) {
    candidate = `${base}-${n}${ext}`
  }
  return candidate
}

/** --name 只能是纯文件名；没写扩展名时补上源文件的扩展名（方便类型识别）。 */
function resolveDesiredName(sourcePath, requestedName) {
  if (!requestedName) return path.basename(sourcePath)
  const name = String(requestedName).trim()
  if (name === '' || name === '.' || name === '..') fail('BAD_ARGS', `--name 不是合法文件名：${requestedName}`)
  if (/[\\/:*?"<>|]/.test(name)) fail('BAD_ARGS', `--name 只能是文件名（不能含 \\ / : * ? " < > |）：${name}`)
  const sourceExt = path.extname(sourcePath)
  if (path.extname(name) === '' && sourceExt !== '') return `${name}${sourceExt}`
  return name
}

// ---------------------------------------------------------------------------
// PowerShell 通道（剪贴板 / 资源管理器）
// ---------------------------------------------------------------------------

function psQuote(value) {
  return String(value).replace(/'/g, "''")
}

/** 用 -EncodedCommand（Base64 UTF-16LE）跑一段 PowerShell，避免引号/中文转义地狱。 */
function runPowerShell(script, errorCode, timeoutMs = 30000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = spawnSync(
    POWERSHELL_EXE,
    ['-NoProfile', '-STA', '-EncodedCommand', encoded],
    { windowsHide: true, encoding: 'utf8', timeout: timeoutMs },
  )
  if (result.error) {
    fail(errorCode || 'POWERSHELL_FAILED', `无法调用 PowerShell（${POWERSHELL_EXE}）：${result.error.message}`)
  }
  const stdout = String(result.stdout || '').trim()
  const stderr = String(result.stderr || '').trim()
  if (result.status !== 0) {
    fail(errorCode || 'POWERSHELL_FAILED', `PowerShell 退出码 ${result.status}：${stderr || stdout || '（无输出）'}`)
  }
  return stdout
}

/** 图片 -> 图像剪贴板（微信里 Ctrl+V 直接是图片）。 */
function copyImageToClipboard(absPath) {
  const p = psQuote(absPath)
  const script = String.raw`Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$ErrorActionPreference = 'Stop'
$img = [System.Drawing.Image]::FromFile('${p}')
try {
  [System.Windows.Forms.Clipboard]::SetImage($img)
} finally {
  $img.Dispose()
}
if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { throw 'SetImage 之后剪贴板里没有图像' }
Write-Output 'IMAGE_OK'`
  const output = withRetry(() => runPowerShell(script, 'CLIPBOARD_IMAGE_FAILED'))
  if (!output.includes('IMAGE_OK')) fail('CLIPBOARD_IMAGE_FAILED', `图片剪贴板写入未确认成功：${output || '（无输出）'}`)
  return 'IMAGE_OK'
}

/** 其它文件 -> 文件剪贴板（等价于资源管理器里 Ctrl+C 一个文件，微信里 Ctrl+V 是附件）。 */
function copyFileToClipboard(absPath) {
  const p = psQuote(absPath)
  const script = String.raw`Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'
$items = New-Object System.Collections.Specialized.StringCollection
[void]$items.Add('${p}')
[System.Windows.Forms.Clipboard]::SetFileDropList($items)
if (-not [System.Windows.Forms.Clipboard]::ContainsFileDropList()) { throw 'SetFileDropList 之后剪贴板里没有文件列表' }
Write-Output 'FILE_OK'`
  const output = withRetry(() => runPowerShell(script, 'CLIPBOARD_FILE_FAILED'))
  if (!output.includes('FILE_OK')) fail('CLIPBOARD_FILE_FAILED', `文件剪贴板写入未确认成功：${output || '（无输出）'}`)
  return 'FILE_OK'
}

/** 决定这次到底走图像还是文件剪贴板；mode=image 但文件非图片时明确报错，不静默降级。 */
function resolveClipboardMode(item, requestedMode) {
  const requested = requestedMode ? String(requestedMode).toLowerCase() : 'auto'
  if (!CLIPBOARD_MODES.includes(requested)) {
    fail('BAD_ARGS', `--mode 只能是 auto|image|file，收到：${requestedMode}`)
  }
  let mode = requested
  if (mode === 'auto') mode = item.kind === 'image' ? 'image' : 'file'
  if (mode === 'image' && item.kind !== 'image') {
    fail('NOT_IMAGE', `--mode image 只适用于图片文件：${item.name}（kind=${item.kind}）`)
  }
  return mode
}

function copyItemToClipboard(item, requestedMode) {
  const mode = resolveClipboardMode(item, requestedMode)
  const abs = item.path || path.join(INBOX_ROOT, item.name)
  if (!fs.existsSync(abs)) fail('NOT_FOUND', `文件不存在：${abs}`)
  if (mode === 'image') copyImageToClipboard(abs)
  else copyFileToClipboard(abs)
  return mode
}

/** 资源管理器里选中文件（用 Start-Process 传 /select,"绝对路径"，带空格/中文都稳）。 */
function revealItem(item) {
  const p = psQuote(item.path || path.join(INBOX_ROOT, item.name))
  const script = String.raw`$ErrorActionPreference = 'Stop'
$arguments = '/select,"${p}"'
Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList $arguments
Write-Output 'REVEAL_OK'`
  const output = runPowerShell(script, 'REVEAL_FAILED', 15000)
  if (!output.includes('REVEAL_OK')) fail('REVEAL_FAILED', `资源管理器调用未确认成功：${output || '（无输出）'}`)
}

/** 打开取件箱文件夹本身。 */
function openInboxFolder() {
  const p = psQuote(INBOX_ROOT)
  const script = String.raw`$ErrorActionPreference = 'Stop'
$arguments = '"${p}"'
Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList $arguments
Write-Output 'OPEN_OK'`
  const output = runPowerShell(script, 'OPEN_FAILED', 15000)
  if (!output.includes('OPEN_OK')) fail('OPEN_FAILED', `打开取件箱失败：${output || '（无输出）'}`)
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

function cmdAdd(options) {
  if (options.positional.length < 1) fail('BAD_ARGS', 'add 需要 <文件> 参数')
  if (options.positional.length > 1) fail('BAD_ARGS', `add 只接受一个源文件，多出：${options.positional.slice(1).join(' ')}`)

  const source = path.resolve(options.positional[0])
  let sourceStat
  try {
    sourceStat = fs.statSync(source)
  } catch {
    fail('NOT_FOUND', `源文件不存在：${source}`)
  }
  if (sourceStat.isDirectory()) {
    fail('IS_DIR', `add 不接受目录（不递归，避免把中间产物一次塞进来）：${source}`)
  }
  if (!sourceStat.isFile()) fail('NOT_FILE', `不是普通文件：${source}`)

  ensureInboxRoot()
  const desiredName = resolveDesiredName(source, options.name)
  const targetName = uniqueTargetName(desiredName)
  const targetPath = path.join(INBOX_ROOT, targetName)

  // --link：优先硬链接（同盘不占空间、秒完成，适合几百 MB 的成片）；跨盘/不支持再退回复制。
  // 硬链接时不改 mtime（改的是同一个 inode，会连源文件的时间一起改掉）。
  let method = 'copy'
  if (options.link) {
    try {
      fs.linkSync(source, targetPath)
      method = 'link'
    } catch {
      method = 'copy'
    }
  }
  if (method === 'copy') {
    fs.copyFileSync(source, targetPath)
    // 入库时间 = 复制时间：Windows 的 CopyFileW 会保留源 mtime，这里显式改成「现在」，
    // 这样「最新在上」按入库时间排（隔天再交付旧文件也会排到最上面）。
    try {
      const now = new Date()
      fs.utimesSync(targetPath, now, now)
    } catch {
      /* 改不动 mtime 就退回源 mtime，不影响主流程 */
    }
  }
  const targetStat = fs.statSync(targetPath)
  if (targetStat.size !== sourceStat.size) {
    fail('COPY_FAILED', `复制后大小不一致：源 ${sourceStat.size} B / 目标 ${targetStat.size} B`)
  }

  // 来源标注：--origin 是「哪个对话/会话」产的，--project 不写就按源路径猜
  const project = options.project !== null && options.project !== undefined && options.project !== ''
    ? String(options.project)
    : inferProject(source)
  const origin = options.origin !== null && options.origin !== undefined && options.origin !== ''
    ? String(options.origin)
    : null
  let meta = null
  if (origin !== null || project !== null) {
    meta = setOriginMeta(targetName, { origin, project })
  }

  const item = { ...itemOfName(targetName, targetStat, meta), path: targetPath }

  let copied = false
  let mode = null
  if (options.clip) {
    try {
      mode = copyItemToClipboard(item, 'auto')
      copied = true
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      fail(error && error.code ? error.code : 'CLIPBOARD_FAILED', `文件已加入取件箱（${targetName}），但复制到剪贴板失败：${message}`)
    }
  }
  if (options.reveal) revealItem(item)

  if (options.json) {
    emitJson({ ok: true, root: INBOX_ROOT, item, path: targetPath, method, copied, mode, revealed: !!options.reveal })
  } else {
    const extras = []
    if (method === 'link') extras.push('硬链接（未占额外空间）')
    if (copied) extras.push(`已复制到剪贴板（${mode}）`)
    if (options.reveal) extras.push('已在资源管理器中选中')
    if (item.origin) extras.push(`来源对话：${item.origin}`)
    if (item.project) extras.push(`项目：${item.project}`)
    const suffix = extras.length ? `；${extras.join('；')}` : ''
    process.stdout.write(`已加入取件箱：${targetName}（${item.kind}，${humanSize(item.size)}）${suffix}\n`)
  }
}

function cmdList(options) {
  if (options.positional.length > 0) fail('BAD_ARGS', `list 不接受位置参数：${options.positional.join(' ')}`)
  const items = listItems()
  if (options.json) {
    emitJson({ ok: true, root: INBOX_ROOT, items })
    return
  }
  if (items.length === 0) {
    process.stdout.write(`取件箱是空的：${INBOX_ROOT}\n`)
    return
  }
  process.stdout.write(`取件箱：${INBOX_ROOT}（${items.length} 件，最新在上）\n`)
  for (const item of items) {
    const origin = item.origin ? `  ← ${item.origin}` : (item.project ? `  ← ${item.project}` : '')
    process.stdout.write(
      `  ${humanTime(item.mtime)}  ${item.kind.padEnd(7)}  ${humanSize(item.size).padStart(9)}  ${item.name}${origin}\n`,
    )
  }
}

function cmdCopy(options) {
  if (options.positional.length > 1) fail('BAD_ARGS', `copy 最多一个参数（name|latest），多出：${options.positional.slice(1).join(' ')}`)
  const item = getItem(options.positional[0])
  const mode = copyItemToClipboard(item, options.mode)
  if (options.json) {
    emitJson({ ok: true, root: INBOX_ROOT, mode, item })
  } else {
    process.stdout.write(`已复制到剪贴板（${mode}）：${item.name}\n`)
  }
}

function cmdReveal(options) {
  if (options.positional.length > 1) fail('BAD_ARGS', `reveal 最多一个参数（name|latest），多出：${options.positional.slice(1).join(' ')}`)
  const item = getItem(options.positional[0])
  revealItem(item)
  if (options.json) {
    emitJson({ ok: true, root: INBOX_ROOT, item })
  } else {
    process.stdout.write(`已在资源管理器中选中：${item.name}\n`)
  }
}

function cmdOpen(options) {
  if (options.positional.length > 0) fail('BAD_ARGS', `open 不接受位置参数：${options.positional.join(' ')}`)
  ensureInboxRoot()
  openInboxFolder()
  if (options.json) {
    emitJson({ ok: true, root: INBOX_ROOT })
  } else {
    process.stdout.write(`已打开取件箱：${INBOX_ROOT}\n`)
  }
}

/**
 * tag：给取件箱里已有的一件补「来源标注」（哪个对话 / 哪个项目）。
 * 用 add 时没写 --origin 的旧文件、或手动拖进取件箱的文件，都可以这样补。
 */
function cmdTag(options) {
  if (options.positional.length > 1) fail('BAD_ARGS', `tag 最多一个参数（name|latest），多出：${options.positional.slice(1).join(' ')}`)
  if (!options.origin && !options.project) fail('BAD_ARGS', 'tag 至少要有 --origin 或 --project')
  const item = getItem(options.positional[0])
  const meta = setOriginMeta(item.name, {
    origin: options.origin === null ? undefined : options.origin,
    project: options.project === null ? undefined : options.project,
  })
  const updated = { ...itemOfName(item.name, fs.statSync(item.path), meta), path: item.path }
  if (options.json) {
    emitJson({ ok: true, root: INBOX_ROOT, item: updated })
  } else {
    const bits = []
    if (updated.origin) bits.push(`来源对话：${updated.origin}`)
    if (updated.project) bits.push(`项目：${updated.project}`)
    process.stdout.write(`已标注：${updated.name}（${bits.join('；')}）\n`)
  }
}

// ---------------------------------------------------------------------------
// 参数解析与入口
// ---------------------------------------------------------------------------

/**
 * 解析：命令名词 + 位置参数 + 开关（--json/--clip/--reveal/--name/--mode）。
 * 支持 --name=xxx / --mode=xxx 写法。
 */
function parseArgv(argv) {
  const options = {
    command: null,
    positional: [],
    json: false,
    clip: false,
    reveal: false,
    link: false,
    name: null,
    mode: null,
    origin: null,
    project: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') options.json = true
    else if (arg === '--clip') options.clip = true
    else if (arg === '--reveal') options.reveal = true
    else if (arg === '--link') options.link = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--name' || arg === '-n') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail('BAD_ARGS', '--name 需要一个值')
      options.name = value
      i += 1
    } else if (arg.startsWith('--name=')) options.name = arg.slice('--name='.length)
    else if (arg === '--mode' || arg === '-m') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail('BAD_ARGS', '--mode 需要一个值')
      options.mode = value
      i += 1
    } else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length)
    else if (arg === '--origin' || arg === '-o') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail('BAD_ARGS', '--origin 需要一个值')
      options.origin = value
      i += 1
    } else if (arg.startsWith('--origin=')) options.origin = arg.slice('--origin='.length)
    else if (arg === '--project' || arg === '-p') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail('BAD_ARGS', '--project 需要一个值')
      options.project = value
      i += 1
    } else if (arg.startsWith('--project=')) options.project = arg.slice('--project='.length)
    else if (arg === '--') {
      options.positional.push(...argv.slice(i + 1))
      break
    } else if (arg.startsWith('-') && arg !== '-') fail('BAD_ARGS', `未知参数：${arg}`)
    else if (options.command === null) options.command = arg
    else options.positional.push(arg)
  }
  return options
}

function printUsage() {
  process.stdout.write(
    [
      '取件箱（inbox）命令行工具 —— 零依赖',
      '',
      '用法：',
      '  node inbox.mjs add <文件> [--name "新名字"] [--clip] [--reveal] [--link] [--origin "会话标题"] [--project "项目"] [--json]',
      '  node inbox.mjs list [--json]',
      '  node inbox.mjs copy [name|latest] [--mode auto|image|file] [--json]',
      '  node inbox.mjs reveal [name|latest] [--json]',
      '  node inbox.mjs tag [name|latest] --origin "会话标题" [--project "项目"] [--json]',
      '  node inbox.mjs open [--json]',
      '',
      '说明：',
      `  取件箱根目录：${INBOX_ROOT}`,
      '  环境变量 DSH_INBOX_DIR 可覆盖；目录不存在会自动创建。',
      '  --clip：复制到剪贴板（图片→图像剪贴板，其它→文件剪贴板）。',
      '  --link：同盘优先硬链接（大视频不占额外空间），不支持时自动退回复制。',
      '  --origin/--project：标注这件东西是哪个对话、哪个项目产出的（面板按它分组）。',
      '  copy/reveal/tag 省略 name 时作用于最新一件（latest）。',
      '',
    ].join('\n'),
  )
}

function main(argv) {
  const options = parseArgv(argv)
  if (options.help || options.command === null) {
    printUsage()
    return 0
  }
  switch (options.command) {
    case 'add':
      cmdAdd(options)
      break
    case 'list':
      cmdList(options)
      break
    case 'copy':
      cmdCopy(options)
      break
    case 'reveal':
      cmdReveal(options)
      break
    case 'tag':
      cmdTag(options)
      break
    case 'open':
      cmdOpen(options)
      break
    default:
      fail('UNKNOWN_CMD', `未知命令：${options.command}（可用：add / list / copy / reveal / tag / open）`)
  }
  return 0
}

try {
  const exitCode = main(process.argv.slice(2))
  process.exit(exitCode)
} catch (error) {
  const isCli = error instanceof CliError
  const code = isCli ? error.code : 'INTERNAL'
  const message = error && error.message ? error.message : String(error)
  process.stderr.write(`错误[${code}]：${message}\n`)
  if (process.argv.includes('--json')) emitJson({ ok: false, error: { code, message } })
  process.exit(isCli && code === 'BAD_ARGS' ? 2 : 1)
}

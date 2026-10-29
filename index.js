/**
 * 「取件箱」Host 半边：把本机取件箱目录暴露成一组同源 HTTP 接口，供 DSH 侧栏面板使用。
 *
 * 取件箱根目录：默认是「用户主目录\取件箱」，可用 DSH_INBOX_DIR 或插件目录里的 inbox.config.json 覆盖；不存在时自动创建。
 * 里面只有平铺的交付物文件；子目录（如 旧\）不进列表。
 *
 * 注册的路由（全部包在 apply 的 ctx.effect 里，插件卸载时自动注销）：
 *   GET  /api/inbox/list          → { ok:true, root, items:[{name,kind,ext,size,mtime,url}] }（mtime 倒序，最多 200 条）
 *   GET  /api/inbox/file?name=    → 文件字节；支持 Range（206 + Content-Range），inline 展示
 *   POST /api/inbox/copy          → { name, mode:"auto"|"image"|"file" } 复制到剪贴板（图片=图像，其余=文件拖放列表）
 *   POST /api/inbox/reveal        → { name } explorer.exe /select,"<绝对路径>"
 *   POST /api/inbox/open          → { name } 用系统默认程序打开
 *   POST /api/inbox/delete        → { name } 删到回收站（Microsoft.VisualBasic SendToRecycleBin，不允许硬删）
 *   POST /api/inbox/open-folder   → 无 body，用资源管理器打开取件箱根目录
 *
 * 约定：
 *   - 只用 Node 内置模块（离线 file: 方式安装时也能解析）。
 *   - 任何 handler 都不把异常抛出去：4xx/5xx + { ok:false, error:{ code, message } }。
 *   - 响应一律 application/json; charset=utf-8 + cache-control: no-store（/file 的正常字节流除外）。
 */
import { promises as fs, createReadStream, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

/** 插件自己的目录（用来找 inbox.config.json）。 */
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.join(PACKAGE_DIR, 'inbox.config.json')
/** 没配置时的默认取件箱：用户主目录下的「取件箱」（Windows: C:\Users\<你>\取件箱）。 */
const FALLBACK_INBOX_DIR = path.join(os.homedir(), '取件箱')

/** 默认取件箱目录（安装器会写 inbox.config.json 覆盖它）。 */
const DEFAULT_INBOX_DIR = FALLBACK_INBOX_DIR
const API_PREFIX = '/api/inbox'
/** 列表里 url 字段是相对路径（桌面端页面在 dsh-app://app/，不能带前导斜杠）。 */
const RELATIVE_FILE_URL = 'api/inbox/file'
const MAX_BODY_BYTES = 64 * 1024
const MAX_LIST_ITEMS = 200
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const POWERSHELL_TIMEOUT_MS = 20000
/** 明确不算交付物的文件名（小写比较）。 */
const IGNORED_FILE_NAMES = new Set(['desktop.ini'])

/** 类型映射（与规格 / Client 端必须一致）；ext 为小写、不带点。 */
const KIND_BY_EXT = (() => {
  const table = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'],
    video: ['mp4', 'webm', 'mov', 'm4v', 'mkv'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
    pdf: ['pdf'],
    text: ['txt', 'md', 'json', 'js', 'ts', 'css', 'html', 'htm', 'csv', 'log', 'yml', 'yaml', 'py', 'ps1', 'bat', 'cmd', 'sql', 'xml'],
    doc: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
    archive: ['zip', 'rar', '7z'],
  }
  const map = new Map()
  for (const [kind, extensions] of Object.entries(table)) {
    for (const extension of extensions) map.set(extension, kind)
  }
  return map
})()

/** /file 的 content-type 映射。 */
const MIME_BY_EXT = (() => {
  const table = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/gif': ['gif'],
    'image/webp': ['webp'],
    'image/bmp': ['bmp'],
    'image/svg+xml': ['svg'],
    'image/avif': ['avif'],
    'video/mp4': ['mp4'],
    'video/webm': ['webm'],
    'video/quicktime': ['mov'],
    'video/x-m4v': ['m4v'],
    'video/x-matroska': ['mkv'],
    'audio/mpeg': ['mp3'],
    'audio/wav': ['wav'],
    'audio/mp4': ['m4a'],
    'audio/aac': ['aac'],
    'audio/flac': ['flac'],
    'audio/ogg': ['ogg'],
    'application/pdf': ['pdf'],
    'text/plain; charset=utf-8': ['txt', 'ts', 'log', 'py', 'ps1', 'bat', 'cmd', 'sql'],
    'text/markdown; charset=utf-8': ['md'],
    'application/json; charset=utf-8': ['json'],
    'text/javascript; charset=utf-8': ['js'],
    'text/css; charset=utf-8': ['css'],
    'text/html; charset=utf-8': ['html', 'htm'],
    'text/csv; charset=utf-8': ['csv'],
    'text/yaml; charset=utf-8': ['yml', 'yaml'],
    'application/xml; charset=utf-8': ['xml'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-excel': ['xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/vnd.ms-powerpoint': ['ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
    'application/zip': ['zip'],
    'application/vnd.rar': ['rar'],
    'application/x-7z-compressed': ['7z'],
  }
  const map = new Map()
  for (const [mime, extensions] of Object.entries(table)) {
    for (const extension of extensions) map.set(extension, mime)
  }
  return map
})()

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 带 HTTP 状态的错误；guard 统一把它翻成 JSON 错误响应。 */
function httpError(status, code, message) {
  const error = new Error(message)
  error.httpStatus = status
  error.code = code
  return error
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/** 失败响应：已经发过 header 的（比如文件流中途出错）只收尾，不再写 JSON。 */
function sendFailure(res, error) {
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : 500
  const code = typeof error?.code === 'string' && error.code !== '' ? error.code : 'internal-error'
  const message = error instanceof Error ? error.message : String(error)
  if (status >= 500) console.warn('[inbox] 请求失败：', message)
  try {
    if (res.headersSent || res.writableEnded) {
      if (!res.writableEnded) res.end()
      return
    }
    jsonResponse(res, status, { ok: false, error: { code, message } })
  } catch {
    try {
      if (typeof res.destroy === 'function') res.destroy()
    } catch { /* 已经没救了 */ }
  }
}

/** handler 统一包一层 try/catch：任何异常都变成 JSON 错误，不往外抛。 */
function guard(handler) {
  return async function guardedHandler(req, res) {
    try {
      await handler(req !== undefined && req !== null ? req : {}, res)
    } catch (error) {
      sendFailure(res, error)
    }
  }
}

/** 读 header：Node 的 req.headers 键是小写，这里兼容手工构造的 req。 */
function readHeader(req, name) {
  const headers = req !== null && typeof req === 'object' ? req.headers : undefined
  if (headers === undefined || headers === null) return undefined
  const lower = name.toLowerCase()
  if (headers[lower] !== undefined) return headers[lower]
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return undefined
}

/** 读插件目录里的 inbox.config.json（安装器写的），取 inboxDir；读不到/不合法返回 ''。 */
function readConfigInboxDir() {
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    if (data !== null && typeof data === 'object' && typeof data.inboxDir === 'string' && data.inboxDir.trim() !== '') {
      return data.inboxDir.trim()
    }
  } catch { /* 没有配置文件就退回默认 */ }
  return ''
}

/** 取件箱根目录：DSH_INBOX_DIR > inbox.config.json > 用户主目录\取件箱。 */
function resolveInboxDir() {
  const configured = process.env.DSH_INBOX_DIR
  const fromEnv = typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : ''
  if (fromEnv !== '') return path.resolve(fromEnv)
  const fromConfig = readConfigInboxDir()
  if (fromConfig !== '') return path.resolve(fromConfig)
  return DEFAULT_INBOX_DIR
}

/** 取件箱根目录（不存在就创建）。 */
async function ensureInboxRoot() {
  const root = resolveInboxDir()
  try {
    await fs.mkdir(root, { recursive: true })
  } catch (error) {
    throw httpError(500, 'inbox-unavailable', `取件箱目录不可用（${root}）：${error instanceof Error ? error.message : String(error)}`)
  }
  return root
}

/** 扩展名：小写、不带点；没有就返回 ''。 */
function extensionOf(name) {
  return path.extname(String(name)).replace(/^\./, '').toLowerCase()
}

// ---------------------------------------------------------------------------
// 来源标注：哪个对话 / 哪个项目产出的 —— 存在取件箱里的隐藏文件 .origins.json
//   { version: 1, items: { "<文件名>": { origin, project, sessionId, updatedAt } } }
// 隐藏文件不进列表；读坏了就当空表，绝不影响取件箱本身。
// ---------------------------------------------------------------------------

const ORIGINS_FILE_NAME = '.origins.json'

async function readOrigins(root) {
  try {
    const raw = await fs.readFile(path.join(root, ORIGINS_FILE_NAME), 'utf8')
    const data = JSON.parse(raw)
    if (data !== null && typeof data === 'object' && data.items !== null && typeof data.items === 'object') {
      return data.items
    }
  } catch { /* 不存在 / 坏了都当空表 */ }
  return {}
}

async function writeOrigins(root, items) {
  try {
    await fs.writeFile(
      path.join(root, ORIGINS_FILE_NAME),
      `${JSON.stringify({ version: 1, items }, null, 2)}\n`,
      'utf8',
    )
    return true
  } catch {
    return false
  }
}

/** 把来源标注合并进列表项（字段与 CLI 的 itemOfName 保持一致）。 */
function applyOriginMeta(item, meta) {
  if (meta === null || typeof meta !== 'object') return item
  if (typeof meta.origin === 'string' && meta.origin !== '') item.origin = meta.origin
  if (typeof meta.project === 'string' && meta.project !== '') item.project = meta.project
  if (typeof meta.sessionId === 'string' && meta.sessionId !== '') item.sessionId = meta.sessionId
  return item
}

/** 删除一件时顺手清掉它的标注（失败不影响删除结果）。 */
async function pruneOrigin(root, name) {
  const items = await readOrigins(root)
  if (items[name] === undefined) return
  delete items[name]
  await writeOrigins(root, items)
}

function kindOf(name) {
  return KIND_BY_EXT.get(extensionOf(name)) ?? 'other'
}

function contentTypeOf(name) {
  return MIME_BY_EXT.get(extensionOf(name)) ?? 'application/octet-stream'
}

/**
 * name 只接受单层文件名：拒绝含 \ / : 等路径字符、'..'、控制字符的值。
 * （解析后的绝对路径还会再校验一次必须在取件箱根目录下。）
 */
function isSafeName(name) {
  if (typeof name !== 'string') return false
  if (name === '' || name.length > 255) return false
  if (name !== name.trim()) return false
  if (/[\\/:*?"<>|]/.test(name)) return false
  if (/[\u0000-\u001f]/.test(name)) return false
  if (name === '.' || name === '..') return false
  if (name.includes('..')) return false
  if (name.endsWith('.')) return false
  return true
}

/** 校验 name 并解析成绝对路径；非法一律 400。 */
function resolveInboxPath(root, name) {
  if (!isSafeName(name)) {
    throw httpError(400, 'invalid-name', 'name 只能是不含 \\ / : .. 的单层文件名')
  }
  const resolved = path.resolve(root, name)
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (!resolved.startsWith(rootPrefix)) {
    throw httpError(400, 'invalid-name', 'name 解析后不在取件箱根目录下')
  }
  return resolved
}

/** 解析成一个真实存在的普通文件的绝对路径；不存在 / 是目录一律 404。 */
async function resolveExistingFile(root, name) {
  const abs = resolveInboxPath(root, name)
  let stat
  try {
    stat = await fs.stat(abs)
  } catch (error) {
    if (error?.code === 'ENOENT') throw httpError(404, 'not-found', `取件箱里没有这个文件：${name}`)
    throw httpError(500, 'stat-failed', `读文件信息失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!stat.isFile()) {
    throw httpError(404, 'not-found', `不是普通文件（目录不能当文件用）：${name}`)
  }
  return { abs, stat }
}

/** RFC 5987 的 filename* 取值（' ( ) 必须百分号转义）。 */
function encodeRfc5987(value) {
  return encodeURIComponent(value).replace(/['()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Content-Disposition 的 ASCII 兜底文件名。 */
function asciiFileName(name) {
  return name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
}

/** PowerShell 单引号字符串里的路径：' → ''。 */
function psQuote(value) {
  return String(value).replace(/'/g, "''")
}

/**
 * 解析 Range 头（只支持单段 bytes）：
 *   返回 null      → 忽略 Range，回 200 全文件
 *   返回 'invalid' → 不可满足，回 416
 *   返回 {start,end} → 回 206
 */
function parseRangeHeader(header, size) {
  if (typeof header !== 'string' || header.trim() === '') return null
  const value = header.trim()
  if (!/^bytes=/i.test(value)) return null
  const spec = value.slice(value.indexOf('=') + 1).trim()
  if (spec.includes(',')) return null
  const match = /^(\d*)-(\d*)$/.exec(spec)
  if (match === null) return null
  const rawStart = match[1]
  const rawEnd = match[2]
  if (rawStart === '' && rawEnd === '') return null
  if (size <= 0) return 'invalid'
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid'
    if (suffix >= size) return null
    return { start: size - suffix, end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return 'invalid'
  const end = rawEnd === '' ? size - 1 : Number(rawEnd)
  if (!Number.isFinite(end) || end < start) return 'invalid'
  return { start, end: Math.min(end, size - 1) }
}

/** 读 JSON body（上限 64KB；非法 JSON → 400）。 */
async function readJsonBody(req) {
  const declared = Number(readHeader(req, 'content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw httpError(400, 'body-too-large', '请求体超过 64KB')
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw httpError(400, 'body-too-large', '请求体超过 64KB')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return null
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw httpError(400, 'bad-json', '请求体不是合法 JSON')
  }
}

/** 从 body 里拿 name（缺失时返回 undefined，交给 isSafeName 判 400）。 */
function bodyField(body, key) {
  if (body === null || typeof body !== 'object') return undefined
  return body[key]
}

// ---------------------------------------------------------------------------
// PowerShell / 外部程序
// ---------------------------------------------------------------------------

/** 用 -EncodedCommand（Base64 UTF-16LE）跑一段 PowerShell，返回 { code, stdout, stderr }。 */
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    let child
    try {
      child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch { /* 进程可能已经退了 */ }
      finish(reject, new Error(`PowerShell 超时（${POWERSHELL_TIMEOUT_MS} 毫秒）`))
    }, POWERSHELL_TIMEOUT_MS)
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', error => finish(reject, error))
    child.once('close', code => finish(resolve, { code: code === null ? -1 : code, stdout, stderr }))
  })
}

/** 跑 PowerShell，失败时把退出码 + stderr 一起带进 JSON 错误（不允许静默降级）。 */
async function runPowerShellOrThrow(script, code, label) {
  let result
  try {
    result = await runPowerShell(script)
  } catch (error) {
    throw httpError(500, code, `${label}：${error instanceof Error ? error.message : String(error)}`)
  }
  if (result.code !== 0) {
    const stderr = result.stderr.trim()
    const stdout = result.stdout.trim()
    const detail = stderr !== '' ? stderr : (stdout !== '' ? stdout : '（没有输出）')
    throw httpError(500, code, `${label}：PowerShell 退出码 ${result.code}：${detail}`)
  }
  return result
}

/** 图片 → 图像剪贴板。 */
function imageClipboardScript(abs) {
  return [
    '$ErrorActionPreference = \'Stop\'',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    `$img = [System.Drawing.Image]::FromFile('${psQuote(abs)}')`,
    'try { [System.Windows.Forms.Clipboard]::SetImage($img) } finally { $img.Dispose() }',
  ].join('\n')
}

/** 其它文件 → 文件剪贴板（等价于资源管理器里 Ctrl+C 一个文件）。 */
function fileClipboardScript(abs) {
  return [
    '$ErrorActionPreference = \'Stop\'',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$list = New-Object System.Collections.Specialized.StringCollection',
    `[void]$list.Add('${psQuote(abs)}')`,
    '[System.Windows.Forms.Clipboard]::SetFileDropList($list)',
  ].join('\n')
}

/** 用系统默认程序打开一个文件。 */
function openFileScript(abs) {
  return [
    '$ErrorActionPreference = \'Stop\'',
    `Start-Process -FilePath '${psQuote(abs)}'`,
  ].join('\n')
}

/** 删到回收站（SendToRecycleBin，绝不硬删）。 */
function recycleFileScript(abs) {
  return [
    '$ErrorActionPreference = \'Stop\'',
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${psQuote(abs)}', [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`,
  ].join('\n')
}

/**
 * 用 explorer.exe 打开一个路径（文件 / 文件夹）。explorer 的退出码不可靠（成功也可能回 1），
 * 所以只等 spawn 事件、不等退出；unref 掉，别拖着宿主进程。
 */
function openWithExplorer(args) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('explorer.exe', args, { windowsHide: true, detached: true, stdio: 'ignore' })
    } catch (error) {
      reject(error)
      return
    }
    child.once('error', reject)
    child.once('spawn', () => {
      try {
        child.unref()
      } catch { /* 忽略 */ }
      resolve()
    })
  })
}

// ---------------------------------------------------------------------------
// 路由 handler
// ---------------------------------------------------------------------------

/** GET /api/inbox/list */
async function handleList(req, res) {
  if (req.method !== 'GET') throw httpError(405, 'method-not-allowed', '请用 GET /api/inbox/list')
  const root = await ensureInboxRoot()
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    throw httpError(500, 'list-failed', `读取取件箱目录失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const items = []
  const origins = await readOrigins(root)
  for (const entry of entries) {
    // 只扫一层普通文件：隐藏文件 / desktop.ini / 子目录一律不进列表
    if (!entry.isFile()) continue
    if (entry.name.startsWith('.')) continue
    if (IGNORED_FILE_NAMES.has(entry.name.toLowerCase())) continue
    let stat
    try {
      stat = await fs.stat(path.join(root, entry.name))
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    items.push(applyOriginMeta({
      name: entry.name,
      kind: kindOf(entry.name),
      ext: extensionOf(entry.name),
      size: stat.size,
      mtime: stat.mtimeMs,
      url: `${RELATIVE_FILE_URL}?name=${encodeURIComponent(entry.name)}`,
    }, origins[entry.name]))
  }
  items.sort((a, b) => (b.mtime - a.mtime) || a.name.localeCompare(b.name))
  // 媒体（视频/音频）要走真正的 http origin 才支持 Range 拖进度条；
  // 桌面端页面在 dsh-app://app/ 下，相对路径经自定义协议转发可能丢 Range。
  const headerHost = readHeader(req, 'host')
  const envBase = typeof process.env.DSH_WEB_URL === 'string' ? process.env.DSH_WEB_URL.trim() : ''
  const webBase = envBase !== ''
    ? envBase.replace(/\/+$/, '')
    : (typeof headerHost === 'string' && /^[\w.\-:[\]]+$/.test(headerHost) ? `http://${headerHost}` : '')
  jsonResponse(res, 200, { ok: true, root, webBase, items: items.slice(0, MAX_LIST_ITEMS) })
}

/** GET /api/inbox/file?name= */
async function handleFile(req, res) {
  if (req.method !== 'GET') throw httpError(405, 'method-not-allowed', '请用 GET /api/inbox/file?name=')
  const root = await ensureInboxRoot()
  let url
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
  } catch {
    throw httpError(400, 'bad-request', '请求 URL 不合法')
  }
  const name = url.searchParams.get('name')
  if (name === null || name === '') throw httpError(400, 'invalid-name', '缺少 name 参数')
  const { abs, stat } = await resolveExistingFile(root, name)

  const headers = {
    'content-type': contentTypeOf(name),
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
    'content-disposition': `inline; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeRfc5987(name)}`,
    'x-content-type-options': 'nosniff',
  }

  const range = parseRangeHeader(readHeader(req, 'range'), stat.size)
  if (range === 'invalid') {
    headers['content-range'] = `bytes */${stat.size}`
    res.writeHead(416, headers)
    res.end(JSON.stringify({
      ok: false,
      error: { code: 'range-not-satisfiable', message: `Range 超出文件大小（${stat.size} 字节）` },
    }))
    return
  }

  if (range === null) {
    headers['content-length'] = String(stat.size)
    res.writeHead(200, headers)
    if (stat.size === 0) {
      res.end()
      return
    }
    await pipeline(createReadStream(abs), res)
    return
  }

  headers['content-range'] = `bytes ${range.start}-${range.end}/${stat.size}`
  headers['content-length'] = String(range.end - range.start + 1)
  res.writeHead(206, headers)
  await pipeline(createReadStream(abs, { start: range.start, end: range.end }), res)
}

/** POST /api/inbox/copy */
async function handleCopy(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'method-not-allowed', '请用 POST /api/inbox/copy')
  const root = await ensureInboxRoot()
  const body = await readJsonBody(req)
  const name = bodyField(body, 'name')
  const requestedMode = bodyField(body, 'mode')
  const mode = requestedMode === undefined || requestedMode === null ? 'auto' : requestedMode
  if (mode !== 'auto' && mode !== 'image' && mode !== 'file') {
    throw httpError(400, 'invalid-mode', 'mode 只能是 auto / image / file')
  }
  const { abs } = await resolveExistingFile(root, name)
  const kind = kindOf(name)
  const effectiveMode = mode === 'auto' ? (kind === 'image' ? 'image' : 'file') : mode
  if (effectiveMode === 'image' && kind !== 'image') {
    throw httpError(400, 'not-image', '只有图片能用图像剪贴板；其它文件请把 mode 设为 auto 或 file')
  }
  const script = effectiveMode === 'image' ? imageClipboardScript(abs) : fileClipboardScript(abs)
  await runPowerShellOrThrow(script, 'clipboard-failed', '复制到剪贴板失败')
  jsonResponse(res, 200, { ok: true, mode: effectiveMode, name })
}

/** POST /api/inbox/reveal */
async function handleReveal(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'method-not-allowed', '请用 POST /api/inbox/reveal')
  const root = await ensureInboxRoot()
  const body = await readJsonBody(req)
  const name = bodyField(body, 'name')
  const { abs } = await resolveExistingFile(root, name)
  try {
    await openWithExplorer([`/select,${abs}`])
  } catch (error) {
    throw httpError(500, 'reveal-failed', `打开资源管理器失败：${error instanceof Error ? error.message : String(error)}`)
  }
  jsonResponse(res, 200, { ok: true, name })
}

/** POST /api/inbox/open */
async function handleOpen(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'method-not-allowed', '请用 POST /api/inbox/open')
  const root = await ensureInboxRoot()
  const body = await readJsonBody(req)
  const name = bodyField(body, 'name')
  const { abs } = await resolveExistingFile(root, name)
  await runPowerShellOrThrow(openFileScript(abs), 'open-failed', '用默认程序打开失败')
  jsonResponse(res, 200, { ok: true, name })
}

/** POST /api/inbox/delete */
async function handleDelete(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'method-not-allowed', '请用 POST /api/inbox/delete')
  const root = await ensureInboxRoot()
  const body = await readJsonBody(req)
  const name = bodyField(body, 'name')
  const { abs } = await resolveExistingFile(root, name)
  await runPowerShellOrThrow(recycleFileScript(abs), 'delete-failed', '删到回收站失败')
  // 兜底自检：回收站删除应该是同步的；文件还在就明确报错，绝不偷偷硬删。
  let stillExists = false
  try {
    await fs.stat(abs)
    stillExists = true
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw httpError(500, 'delete-failed', `删到回收站后确认文件状态失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (stillExists) throw httpError(500, 'delete-failed', `删到回收站后文件仍然存在：${name}`)
  await pruneOrigin(root, name)
  jsonResponse(res, 200, { ok: true, name })
}

/** POST /api/inbox/open-folder */
async function handleOpenFolder(req, res) {
  if (req.method !== 'POST') throw httpError(405, 'method-not-allowed', '请用 POST /api/inbox/open-folder')
  const root = await ensureInboxRoot()
  try {
    await openWithExplorer([root])
  } catch (error) {
    throw httpError(500, 'open-folder-failed', `打开取件箱文件夹失败：${error instanceof Error ? error.message : String(error)}`)
  }
  jsonResponse(res, 200, { ok: true, root })
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

/** 解析 webServer 服务（正常是注入的 ctx.webServer）。 */
function resolveWebServer(ctx) {
  try {
    const direct = ctx?.webServer
    if (direct !== undefined && direct !== null && typeof direct.register === 'function') return direct
  } catch { /* 没有这个服务 */ }
  try {
    const viaGet = typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined
    if (viaGet !== undefined && viaGet !== null && typeof viaGet.register === 'function') return viaGet
  } catch { /* 没有这个服务 */ }
  return undefined
}

export const inject = ['webServer']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const webServer = resolveWebServer(ctx)
  if (webServer === undefined) {
    console.warn('[inbox] 没有可用的 webServer 服务，取件箱 Host 路由未注册')
    return
  }

  ctx.effect(() => {
    const routes = [
      ['list', guard(handleList)],
      ['file', guard(handleFile)],
      ['copy', guard(handleCopy)],
      ['reveal', guard(handleReveal)],
      ['open', guard(handleOpen)],
      ['delete', guard(handleDelete)],
      ['open-folder', guard(handleOpenFolder)],
    ]
    const disposers = []
    for (const [route, handler] of routes) {
      const dispose = webServer.register({ kind: 'exact', path: `${API_PREFIX}/${route}`, handler })
      disposers.push(typeof dispose === 'function' ? dispose : () => {})
    }
    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch { /* 卸载时别抛 */ }
      }
    }
  }, 'inbox: host routes')
}

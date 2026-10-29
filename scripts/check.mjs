// 仓库自检：零依赖（只用 Node 内置模块）。
// 跑法：node scripts/check.mjs   （或 npm run check）
// 检查：JS 语法、JSON 合法性、manifest 结构、bundle patch 与包名一致、文件清单存在、
//       没有把本机绝对路径/个人目录写进仓库。
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const NAME = 'dsh-delivery-box'
let pass = 0
let fail = 0

function ok(label) {
  pass += 1
  console.log('  ok  ' + label)
}
function bad(label, detail) {
  fail += 1
  console.log('  FAIL ' + label + (detail ? '  →  ' + detail : ''))
}
function assert(condition, label, detail) {
  if (condition) ok(label)
  else bad(label, detail)
}

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(abs, out)
    else if (entry.isFile()) out.push(abs)
  }
  return out
}

async function read(file) {
  return fs.readFile(file, 'utf8')
}

// 1) JS 语法
const jsFiles = (await walk(ROOT)).filter(file => /\.(mjs|js)$/.test(file))
for (const file of jsFiles) {
  const rel = path.relative(ROOT, file)
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  assert(result.status === 0, `syntax: ${rel}`, String(result.stderr || '').slice(0, 200))
}

// 2) JSON 合法性
const jsonFiles = (await walk(ROOT)).filter(file => /\.json$/.test(file) && !file.includes('node_modules'))
for (const file of jsonFiles) {
  const rel = path.relative(ROOT, file)
  try {
    JSON.parse(await read(file))
    ok(`json: ${rel}`)
  } catch (error) {
    bad(`json: ${rel}`, error.message)
  }
}

// 3) manifest 结构
const pkg = JSON.parse(await read(path.join(ROOT, 'package.json')))
assert(pkg.name === NAME, `package.json name is ${NAME}`, pkg.name)
assert(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version), 'package.json has semver version', pkg.version)
assert(pkg.type === 'module', 'package.json type=module')
assert(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'package.json declares dsh.bundle.patch')
assert(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', 'package.json declares dsh.client.platform=web')
assert(Array.isArray(pkg.files) && pkg.files.includes('index.js') && pkg.files.includes('client.js'), 'package.json files lists entry files')
assert(pkg.license === 'MIT', 'license is MIT')

// 4) cordis.patch.yml 与包名一致
const patch = await read(path.join(ROOT, 'cordis.patch.yml'))
assert(patch.includes(`id: ${NAME}`), 'cordis.patch.yml row id matches package name')
assert(patch.includes(`name: ${NAME}`), 'cordis.patch.yml row name matches package name')

// 5) client bundle 声明 id 与包名一致
const client = await read(path.join(ROOT, 'client.js'))
assert(client.includes(`id: '${NAME}'`), 'client.js ModuleLoader id matches package name')
assert(client.includes("ctx.slots.inject('sidebar.panellist'"), 'client.js registers a sidebar entry')

// 6) package files 里列出的文件都存在
for (const pattern of pkg.files) {
  if (pattern.includes('*')) {
    const dir = pattern.split('/')[0]
    const exists = await fs.stat(path.join(ROOT, dir)).then(stat => stat.isDirectory()).catch(() => false)
    assert(exists, `files entry directory exists: ${dir}`)
    continue
  }
  const exists = await fs.stat(path.join(ROOT, pattern)).then(() => true).catch(() => false)
  assert(exists, `files entry exists: ${pattern}`)
}

// 7) 不要带本机个人路径
const textFiles = (await walk(ROOT)).filter(file => /\.(js|mjs|json|md|yml|yaml|ps1|cmd|txt)$/.test(file))
for (const file of textFiles) {
  const rel = path.relative(ROOT, file)
  if (rel === path.join('scripts', 'check.mjs')) continue
  const text = await read(file)
  assert(!/E:\\+deepseek/i.test(text), `no personal absolute path in ${rel}`)
  assert(!/C:\\+Users\\+[A-Za-z0-9_]+/i.test(text), `no user-profile path in ${rel}`)
}

// 8) 安装器编码（PowerShell 5.1 读中文需要 UTF-8 BOM）
const installerPath = path.join(ROOT, 'installer', 'install.ps1')
const installerBytes = await fs.readFile(installerPath)
assert(
  installerBytes[0] === 0xef && installerBytes[1] === 0xbb && installerBytes[2] === 0xbf,
  'installer/install.ps1 is UTF-8 with BOM (needed for Chinese on PowerShell 5.1)',
)

console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILED'}: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)

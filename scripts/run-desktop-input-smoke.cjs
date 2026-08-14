const path = require('node:path')
const { spawn } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const smokeScript = path.join(projectRoot, 'scripts', 'smoke-desktop-input.cjs')
const environment = { ...process.env, RESEARCH_READER_ISOLATED_DESKTOP_TEST: '1', ELECTRON_ENABLE_LOGGING: '1' }
delete environment.ELECTRON_RUN_AS_NODE

const child = spawn(electronExecutable, [smokeScript], {
  cwd: projectRoot,
  env: environment,
  shell: false,
  windowsHide: false,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let finished = false
const timer = setTimeout(() => {
  if (finished) return
  child.kill()
  process.stderr.write('受控桌面输入烟测在 30 秒内未完成。\n')
  process.exitCode = 1
}, 30000)
child.stdout.on('data', chunk => process.stdout.write(chunk))
child.stderr.on('data', chunk => process.stderr.write(chunk))
child.on('error', error => {
  clearTimeout(timer)
  finished = true
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  clearTimeout(timer)
  finished = true
  if (code !== 0 || signal) {
    process.stderr.write(`受控桌面输入烟测失败：${JSON.stringify({ code, signal })}\n`)
    process.exitCode = 1
  }
})

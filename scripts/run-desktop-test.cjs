const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const smokeMode = process.argv.includes('--smoke')
const mode = smokeMode ? 'smoke' : 'interactive'
const runId = `${Date.now()}-${process.pid}-${randomBytes(3).toString('hex')}`
const runRoot = path.join(projectRoot, '.reader-cache', `desktop-${mode}-${runId}`)
const userDataPath = path.join(runRoot, 'user-data')
const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const mainScript = path.join(projectRoot, 'electron', 'main.cjs')

for (const requiredPath of [electronExecutable, mainScript, path.join(projectRoot, 'dist', 'index.html')]) {
  if (!fs.existsSync(requiredPath)) {
    process.stderr.write(`桌面测试缺少文件：${requiredPath}\n请先执行 npm install 和 npm run build。\n`)
    process.exitCode = 1
    return
  }
}

fs.mkdirSync(userDataPath, { recursive: true })
process.stdout.write(`DESKTOP_TEST_RUN=${JSON.stringify({ mode, runRoot, userDataPath })}\n`)

const child = spawn(electronExecutable, [mainScript], {
  cwd: projectRoot,
  env: {
    ...process.env,
    RESEARCH_READER_DEV_USER_DATA: userDataPath,
    RESEARCH_READER_DESKTOP_SMOKE: smokeMode ? '1' : '0',
    RESEARCH_READER_ISOLATED_DESKTOP_TEST: '1',
    ELECTRON_ENABLE_LOGGING: '1',
  },
  shell: false,
  windowsHide: false,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stderr = ''
child.stdout.on('data', chunk => process.stdout.write(chunk))
child.stderr.on('data', chunk => {
  const text = chunk.toString('utf8')
  stderr += text
  process.stderr.write(text)
})

child.on('error', error => {
  process.stderr.write(`桌面测试无法启动：${error.message}\n`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  const gpuCrash = /GPU process exited unexpectedly|GPU process isn't usable/i.test(stderr)
  if (code !== 0 || signal || gpuCrash) {
    process.stderr.write(`DESKTOP_TEST_FAILED=${JSON.stringify({ code, signal, gpuCrash, runRoot })}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`DESKTOP_TEST_PASSED=${JSON.stringify({ mode, code, runRoot })}\n`)
})

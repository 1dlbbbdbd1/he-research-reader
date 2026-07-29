const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

function findPowerShell() {
  const configured = process.env.READER_POWERSHELL
  if (configured && fs.existsSync(configured)) return configured
  for (const command of ['pwsh.exe', 'powershell.exe']) {
    const found = spawnSync('where.exe', [command], {
      windowsHide: true,
      shell: false,
      encoding: 'utf8',
    })
    const first = found.status === 0
      ? found.stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean)
      : undefined
    if (first && fs.existsSync(first)) return first
  }
  return undefined
}

function runInstallerProcess(executable, scriptPath, runtimeRoot, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-RuntimeRoot',
      runtimeRoot,
    ], {
      cwd: runtimeRoot,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    })
    let output = ''
    const record = (stream, chunk) => {
      const text = chunk.toString('utf8')
      output = `${output}${text}`.slice(-40000)
      onProgress?.({ stream, text })
    }
    child.stdout.on('data', chunk => record('stdout', chunk))
    child.stderr.on('data', chunk => record('stderr', chunk))
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve(output)
      else reject(new Error(`本地 MinerU 组件安装失败（退出码 ${code}）。\n${output.slice(-5000)}`))
    })
  })
}

async function installMineruRuntime({ scriptPath, runtimeRoot, onProgress }) {
  if (process.platform !== 'win32') throw new Error('当前一键安装仅支持 Windows。')
  if (!scriptPath || !fs.existsSync(scriptPath)) throw new Error('安装包中缺少 MinerU 安装脚本。')
  const powershell = findPowerShell()
  if (!powershell) throw new Error('没有找到 PowerShell，无法安装本地 MinerU 组件。')
  const resolvedRuntimeRoot = path.resolve(runtimeRoot)
  await fsPromises.mkdir(resolvedRuntimeRoot, { recursive: true })
  onProgress?.({ stream: 'status', text: '开始准备本地 MinerU。此过程会下载开源运行时和模型依赖，但不会上传论文。' })
  await runInstallerProcess(powershell, scriptPath, resolvedRuntimeRoot, onProgress)
  onProgress?.({ stream: 'status', text: '本地 MinerU 组件安装完成。模型会在首次解析时按需下载。' })
  return {
    installed: true,
    runtimeRoot: resolvedRuntimeRoot,
    localOnly: true,
  }
}

module.exports = {
  findPowerShell,
  installMineruRuntime,
  runInstallerProcess,
}

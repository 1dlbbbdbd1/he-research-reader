const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { findPowerShell } = require('./mineru-install.cjs')

function runTranslationInstaller(executable, scriptPath, runtimeRoot, from, to, onProgress) {
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
      '-FromCode',
      from,
      '-ToCode',
      to,
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
      else reject(new Error(`本地翻译组件安装失败（退出码 ${code}）。\n${output.slice(-5000)}`))
    })
  })
}

async function installTranslationRuntime({ scriptPath, runtimeRoot, from = 'en', to = 'zh', onProgress }) {
  if (process.platform !== 'win32') throw new Error('当前一键安装仅支持 Windows。')
  if (!scriptPath || !fs.existsSync(scriptPath)) throw new Error('安装包中缺少本地翻译安装脚本。')
  const powershell = findPowerShell()
  if (!powershell) throw new Error('没有找到 PowerShell，无法安装本地翻译组件。')
  const resolvedRuntimeRoot = path.resolve(runtimeRoot)
  await fsPromises.mkdir(resolvedRuntimeRoot, { recursive: true })
  onProgress?.({ stream: 'status', text: '开始准备 Argos 本地翻译。首次安装会联网下载开源运行时和语言模型。' })
  await runTranslationInstaller(powershell, scriptPath, resolvedRuntimeRoot, from, to, onProgress)
  onProgress?.({ stream: 'status', text: 'Argos 英文 → 中文本地翻译已安装；之后翻译不需要联网或第三方 Token。' })
  return {
    installed: true,
    runtimeRoot: resolvedRuntimeRoot,
    from,
    to,
    provider: 'argos',
    localOnly: true,
  }
}

module.exports = {
  installTranslationRuntime,
  runTranslationInstaller,
}

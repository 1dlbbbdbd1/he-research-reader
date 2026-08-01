const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { findPowerShell } = require('./mineru-install.cjs')
const { DEFAULT_MODEL } = require('./local-embedding.cjs')

function runEmbeddingInstaller(executable, scriptPath, runtimeRoot, model, onProgress) {
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
      '-Model',
      model,
    ], {
      cwd: runtimeRoot,
      windowsHide: true,
      shell: false,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
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
      else reject(new Error(`本地语义组件安装失败（退出码 ${code}）。\n${output.slice(-5000)}`))
    })
  })
}

async function installEmbeddingRuntime({ scriptPath, runtimeRoot, model = DEFAULT_MODEL, onProgress }) {
  if (process.platform !== 'win32') throw new Error('当前一键安装仅支持 Windows。')
  if (!scriptPath || !fs.existsSync(scriptPath)) throw new Error('安装包中缺少本地语义安装脚本。')
  const powershell = findPowerShell()
  if (!powershell) throw new Error('没有找到 PowerShell，无法安装本地语义组件。')
  const resolvedRuntimeRoot = path.resolve(runtimeRoot)
  await fsPromises.mkdir(resolvedRuntimeRoot, { recursive: true })
  onProgress?.({ stream: 'status', text: '开始准备本地语义检索。首次安装会下载 FastEmbed 和约 90 MB 的开源模型。' })
  await runEmbeddingInstaller(powershell, scriptPath, resolvedRuntimeRoot, model, onProgress)
  onProgress?.({ stream: 'status', text: '本地语义模型已安装；之后建立索引和查询均可离线完成。' })
  return { installed: true, runtimeRoot: resolvedRuntimeRoot, model, provider: 'fastembed-local', localOnly: true }
}

module.exports = { installEmbeddingRuntime, runEmbeddingInstaller }

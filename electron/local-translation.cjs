const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const RESULT_PREFIX = 'READER_ARGOS_RESULT:'
const MAX_TRANSLATION_CHARACTERS = 50000

function normalizeLanguageCode(value, fallback) {
  const code = String(value || fallback).trim().toLowerCase()
  if (!/^[a-z]{2,3}$/.test(code)) throw new Error('语言代码必须是 2–3 位小写字母。')
  return code
}

function candidatePythonExecutables({ projectRoot, runtimeRoot, userDataPath }) {
  const candidates = []
  if (process.env.READER_ARGOS_PYTHON) candidates.push(process.env.READER_ARGOS_PYTHON)
  if (runtimeRoot) candidates.push(path.join(runtimeRoot, 'argos', '.venv', 'Scripts', 'python.exe'))
  if (userDataPath) candidates.push(path.join(userDataPath, 'translation-runtime', 'argos', '.venv', 'Scripts', 'python.exe'))
  if (projectRoot) candidates.push(path.join(projectRoot, '.runtime', 'translation', 'argos', '.venv', 'Scripts', 'python.exe'))
  return [...new Set(candidates)]
}

function findPythonExecutable(options) {
  return candidatePythonExecutables(options).find(candidate => fs.existsSync(candidate))
}

function translationEnvironment(runtimeRoot) {
  const profileRoot = path.join(runtimeRoot, 'profile')
  return {
    ARGOS_PACKAGES_DIR: path.join(runtimeRoot, 'packages'),
    XDG_DATA_HOME: path.join(runtimeRoot, 'data'),
    XDG_CONFIG_HOME: path.join(runtimeRoot, 'config'),
    XDG_CACHE_HOME: path.join(runtimeRoot, 'cache'),
    LOCALAPPDATA: path.join(profileRoot, 'LocalAppData'),
    APPDATA: path.join(profileRoot, 'AppData'),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }
}

function parseBridgeResult(output) {
  const marker = output
    .split(/\r?\n/)
    .reverse()
    .find(line => line.startsWith(RESULT_PREFIX))
  if (!marker) throw new Error(`本地翻译进程没有返回有效结果。\n${output.slice(-2000)}`)
  const payload = JSON.parse(marker.slice(RESULT_PREFIX.length))
  if (!payload.ok) throw new Error(payload.error || '本地翻译失败。')
  return payload.result
}

function runBridge({ pythonExecutable, bridgeScript, runtimeRoot, command, from, to, text, onProgress }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [
      bridgeScript,
      command,
      '--from-code',
      from,
      '--to-code',
      to,
    ], {
      cwd: runtimeRoot,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        ...translationEnvironment(runtimeRoot),
      },
    })
    let output = ''
    const record = (stream, chunk) => {
      const value = chunk.toString('utf8')
      output = `${output}${value}`.slice(-40000)
      onProgress?.({ stream, text: value })
    }
    child.stdout.on('data', chunk => record('stdout', chunk))
    child.stderr.on('data', chunk => record('stderr', chunk))
    child.on('error', reject)
    child.on('exit', code => {
      try {
        const result = parseBridgeResult(output)
        if (code === 0) resolve(result)
        else reject(new Error(result?.error || `本地翻译进程退出码：${code}`))
      } catch (error) {
        reject(error)
      }
    })
    if (command === 'translate') child.stdin.end(JSON.stringify({ text }))
    else child.stdin.end()
  })
}

async function localTranslationStatus(options) {
  const from = normalizeLanguageCode(options.from, 'en')
  const to = normalizeLanguageCode(options.to, 'zh')
  const pythonExecutable = findPythonExecutable(options)
  if (!pythonExecutable || !fs.existsSync(options.bridgeScript)) {
    return {
      available: false,
      from,
      to,
      provider: 'argos',
      localOnly: true,
      message: '尚未安装英文 → 中文本地翻译组件。',
    }
  }
  try {
    const result = await runBridge({
      pythonExecutable,
      bridgeScript: options.bridgeScript,
      runtimeRoot: options.runtimeRoot,
      command: 'status',
      from,
      to,
    })
    return {
      ...result,
      provider: 'argos',
      message: result.available
        ? 'Argos 本地翻译已就绪；翻译文本不会离开本机，也不消耗第三方 Token。'
        : `Argos 已安装，但缺少 ${from} → ${to} 语言模型。`,
    }
  } catch (error) {
    return {
      available: false,
      from,
      to,
      provider: 'argos',
      localOnly: true,
      message: error instanceof Error ? error.message : '无法检查本地翻译组件。',
    }
  }
}

async function translateLocally(options) {
  const text = typeof options.text === 'string' ? options.text.trim() : ''
  if (!text) throw new Error('没有收到需要翻译的选区。')
  if (text.length > MAX_TRANSLATION_CHARACTERS) {
    throw new Error(`单次本地翻译不能超过 ${MAX_TRANSLATION_CHARACTERS.toLocaleString()} 个字符。`)
  }
  const from = normalizeLanguageCode(options.from, 'en')
  const to = normalizeLanguageCode(options.to, 'zh')
  const pythonExecutable = findPythonExecutable(options)
  if (!pythonExecutable) throw new Error('本地翻译组件尚未安装。')
  return runBridge({
    pythonExecutable,
    bridgeScript: options.bridgeScript,
    runtimeRoot: options.runtimeRoot,
    command: 'translate',
    from,
    to,
    text,
    onProgress: options.onProgress,
  })
}

module.exports = {
  MAX_TRANSLATION_CHARACTERS,
  candidatePythonExecutables,
  findPythonExecutable,
  localTranslationStatus,
  normalizeLanguageCode,
  parseBridgeResult,
  runBridge,
  translateLocally,
  translationEnvironment,
}

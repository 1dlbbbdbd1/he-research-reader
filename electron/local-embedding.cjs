const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const RESULT_PREFIX = 'READER_EMBEDDING_RESULT:'
const DEFAULT_MODEL = 'BAAI/bge-small-zh-v1.5'
const MAX_TEXTS = 128
const MAX_CHARACTERS = 8000

function candidatePythonExecutables({ projectRoot, runtimeRoot, userDataPath }) {
  const candidates = []
  if (process.env.READER_EMBEDDING_PYTHON) candidates.push(process.env.READER_EMBEDDING_PYTHON)
  if (runtimeRoot) candidates.push(path.join(runtimeRoot, 'fastembed', '.venv', 'Scripts', 'python.exe'))
  if (userDataPath) candidates.push(path.join(userDataPath, 'embedding-runtime', 'fastembed', '.venv', 'Scripts', 'python.exe'))
  if (projectRoot) candidates.push(path.join(projectRoot, '.runtime', 'embedding', 'fastembed', '.venv', 'Scripts', 'python.exe'))
  return [...new Set(candidates)]
}

function findPythonExecutable(options) {
  return candidatePythonExecutables(options).find(candidate => fs.existsSync(candidate))
}

function embeddingEnvironment(runtimeRoot, offline = true) {
  return {
    FASTEMBED_CACHE_PATH: path.join(runtimeRoot, 'models'),
    READER_EMBEDDING_MANIFEST: path.join(runtimeRoot, 'embedding-manifest.json'),
    HF_HOME: path.join(runtimeRoot, 'cache', 'huggingface'),
    HF_HUB_OFFLINE: offline ? '1' : '0',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }
}

function parseBridgeResult(output) {
  const marker = output.split(/\r?\n/).reverse().find(line => line.startsWith(RESULT_PREFIX))
  if (!marker) throw new Error(`本地语义进程没有返回有效结果。\n${output.slice(-2000)}`)
  const payload = JSON.parse(marker.slice(RESULT_PREFIX.length))
  if (!payload.ok) throw new Error(payload.error || '本地语义处理失败。')
  return payload.result
}

function checkedTexts(values) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_TEXTS) {
    throw new Error(`单次嵌入必须包含 1–${MAX_TEXTS} 条文本。`)
  }
  return values.map(value => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('嵌入文本不能为空。')
    const text = value.trim()
    if (text.length > MAX_CHARACTERS) throw new Error(`单条嵌入文本不能超过 ${MAX_CHARACTERS} 个字符。`)
    return text
  })
}

function runBridge({ pythonExecutable, bridgeScript, runtimeRoot, command, model = DEFAULT_MODEL, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [bridgeScript, command, '--model', model], {
      cwd: runtimeRoot,
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...embeddingEnvironment(runtimeRoot, command !== 'prepare') },
    })
    let output = ''
    const record = chunk => { output = `${output}${chunk.toString('utf8')}`.slice(-4000000) }
    child.stdout.on('data', record)
    child.stderr.on('data', record)
    child.on('error', reject)
    child.on('exit', code => {
      try {
        const result = parseBridgeResult(output)
        if (code === 0) resolve(result)
        else reject(new Error(`本地语义进程退出码：${code}`))
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end(input ? JSON.stringify(input) : undefined)
  })
}

async function localEmbeddingStatus(options) {
  const pythonExecutable = findPythonExecutable(options)
  if (!pythonExecutable || !fs.existsSync(options.bridgeScript)) {
    return {
      available: false,
      provider: 'fastembed-local',
      model: DEFAULT_MODEL,
      localOnly: true,
      message: '尚未安装本地语义检索组件。',
    }
  }
  try {
    const result = await runBridge({
      pythonExecutable,
      bridgeScript: options.bridgeScript,
      runtimeRoot: options.runtimeRoot,
      command: 'status',
    })
    return {
      ...result,
      message: result.available
        ? '本地语义模型已就绪；索引和查询文本不会离开本机。'
        : 'FastEmbed 已安装，但本地模型缓存尚未准备完成。',
    }
  } catch (error) {
    return {
      available: false,
      provider: 'fastembed-local',
      model: DEFAULT_MODEL,
      localOnly: true,
      message: error instanceof Error ? error.message : '无法检查本地语义组件。',
    }
  }
}

async function embedLocally(options) {
  const texts = checkedTexts(options.texts)
  const kind = options.kind === 'query' ? 'query' : 'passage'
  const pythonExecutable = findPythonExecutable(options)
  if (!pythonExecutable) throw new Error('本地语义检索组件尚未安装。')
  return runBridge({
    pythonExecutable,
    bridgeScript: options.bridgeScript,
    runtimeRoot: options.runtimeRoot,
    command: 'embed',
    input: { texts, kind },
  })
}

module.exports = {
  DEFAULT_MODEL,
  MAX_CHARACTERS,
  MAX_TEXTS,
  candidatePythonExecutables,
  checkedTexts,
  embeddingEnvironment,
  embedLocally,
  findPythonExecutable,
  localEmbeddingStatus,
  parseBridgeResult,
  runBridge,
}

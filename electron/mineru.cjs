const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')

const MAX_IPC_FILE_BYTES = 500 * 1024 * 1024

function safeFileName(value) {
  const base = path.basename(String(value || 'document.pdf'))
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim()
  return cleaned || 'document.pdf'
}

function candidateExecutables({ projectRoot, resourcesPath, runtimeRoot, userDataPath }) {
  const candidates = []
  if (process.env.READER_MINERU_EXECUTABLE) candidates.push(process.env.READER_MINERU_EXECUTABLE)
  if (runtimeRoot) candidates.push(path.join(runtimeRoot, 'mineru', '.venv', 'Scripts', 'mineru.exe'))
  if (userDataPath) candidates.push(path.join(userDataPath, 'mineru-runtime', 'mineru', '.venv', 'Scripts', 'mineru.exe'))
  if (projectRoot) candidates.push(path.join(projectRoot, '.runtime', 'mineru', '.venv', 'Scripts', 'mineru.exe'))
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'mineru-runtime', 'mineru', '.venv', 'Scripts', 'mineru.exe'))
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'mineru-runtime', 'Scripts', 'mineru.exe'))
  return [...new Set(candidates)]
}

function findMineruExecutable(options) {
  return candidateExecutables(options).find(candidate => fsSync.existsSync(candidate))
}

async function listMarkdownFiles(directory) {
  const found = []
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(target)
    }
  }
  await visit(directory)
  return found
}

function runMineruProcess(executable, args, cwd, onProgress, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        ...environment,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    })
    let output = ''
    const record = (stream, chunk) => {
      const text = chunk.toString('utf8')
      output = `${output}${text}`.slice(-30000)
      onProgress?.({ stream, text })
    }
    child.stdout.on('data', chunk => record('stdout', chunk))
    child.stderr.on('data', chunk => record('stderr', chunk))
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve(output)
      else reject(new Error(`MinerU 本地解析失败（退出码 ${code}）。\n${output.slice(-4000)}`))
    })
  })
}

async function mineruStatus({ projectRoot, resourcesPath, runtimeRoot, userDataPath }) {
  const executable = findMineruExecutable({ projectRoot, resourcesPath, runtimeRoot, userDataPath })
  return {
    available: Boolean(executable),
    backend: 'pipeline',
    localOnly: true,
    executable: executable || undefined,
    message: executable
      ? '本地 MinerU 已就绪；解析文件不会上传到云端。'
      : '尚未安装项目专用的本地 MinerU 运行时。',
  }
}

async function parseWithMineru({ app, projectRoot, resourcesPath, runtimeRoot, input, onProgress, apiUrl }) {
  const executable = findMineruExecutable({
    projectRoot,
    resourcesPath,
    runtimeRoot,
    userDataPath: app.getPath('userData'),
  })
  if (!executable) throw new Error('本地 MinerU 尚未安装，请先完成本地解析组件安装。')

  const bytes = input?.bytes
  const byteLength = bytes?.byteLength ?? bytes?.length ?? 0
  if (!byteLength) throw new Error('没有收到需要解析的本地文件。')
  if (byteLength > MAX_IPC_FILE_BYTES) throw new Error('当前本地解析桥接限制单文件不超过 500MB。')

  const taskId = typeof input.taskId === 'string' && input.taskId ? input.taskId : randomUUID()
  const jobsRoot = path.join(app.getPath('userData'), 'mineru-jobs')
  const taskRoot = path.join(jobsRoot, taskId)
  const inputRoot = path.join(taskRoot, 'input')
  const outputRoot = path.join(taskRoot, 'output')
  await fs.mkdir(inputRoot, { recursive: true })
  await fs.mkdir(outputRoot, { recursive: true })

  const inputPath = path.join(inputRoot, safeFileName(input.fileName))
  await fs.writeFile(inputPath, Buffer.from(bytes))
  onProgress?.({ stream: 'status', text: '文件已写入本地解析任务，正在启动 MinerU。' })

  const resolvedRuntimeRoot = runtimeRoot
    || (projectRoot ? path.join(projectRoot, '.runtime') : path.join(app.getPath('userData'), 'mineru-runtime'))
  const modelCacheRoot = path.join(resolvedRuntimeRoot, 'models')
  await fs.mkdir(modelCacheRoot, { recursive: true })
  const args = ['-p', inputPath, '-o', outputRoot, '-b', 'pipeline']
  if (apiUrl) args.push('--api-url', apiUrl)
  const log = await runMineruProcess(
    executable,
    args,
    taskRoot,
    onProgress,
    {
      HF_HOME: path.join(modelCacheRoot, 'huggingface'),
      MODELSCOPE_CACHE: path.join(modelCacheRoot, 'modelscope'),
      MODELSCOPE_HOME: path.join(modelCacheRoot, 'modelscope-sdk'),
      UV_CACHE_DIR: path.join(resolvedRuntimeRoot, 'cache'),
      MINERU_TOOLS_CONFIG_JSON: path.join(resolvedRuntimeRoot, 'mineru.json'),
    },
  )

  const markdownFiles = await listMarkdownFiles(outputRoot)
  if (!markdownFiles.length) {
    throw new Error(`MinerU 已结束，但没有在本地输出目录生成 Markdown。\n${log.slice(-4000)}`)
  }
  const primaryMarkdown = markdownFiles.sort((a, b) => fsSync.statSync(b).size - fsSync.statSync(a).size)[0]
  const markdown = await fs.readFile(primaryMarkdown, 'utf8')
  return {
    taskId,
    markdown,
    markdownPath: primaryMarkdown,
    outputDirectory: outputRoot,
    backend: 'pipeline',
    localOnly: true,
  }
}

module.exports = {
  candidateExecutables,
  findMineruExecutable,
  mineruStatus,
  parseWithMineru,
  safeFileName,
}

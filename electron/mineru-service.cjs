const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { findMineruExecutable } = require('./mineru.cjs')

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : undefined
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function healthCheck(url) {
  return new Promise(resolve => {
    const request = http.get(`${url}/openapi.json`, response => {
      response.resume()
      resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 500))
    })
    request.setTimeout(1500, () => {
      request.destroy()
      resolve(false)
    })
    request.on('error', () => resolve(false))
  })
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

class MineruLocalService {
  constructor({ projectRoot, resourcesPath, userDataPath, runtimeRoot }) {
    this.projectRoot = projectRoot
    this.resourcesPath = resourcesPath
    this.userDataPath = userDataPath
    this.runtimeRoot = runtimeRoot
    this.child = undefined
    this.apiUrl = undefined
    this.starting = undefined
  }

  environment() {
    const runtimeRoot = this.runtimeRoot
      || (this.projectRoot ? path.join(this.projectRoot, '.runtime') : path.join(this.userDataPath, 'mineru-runtime'))
    const modelRoot = path.join(runtimeRoot, 'models')
    return {
      ...process.env,
      HF_HOME: path.join(modelRoot, 'huggingface'),
      MODELSCOPE_CACHE: path.join(modelRoot, 'modelscope'),
      MODELSCOPE_HOME: path.join(modelRoot, 'modelscope-sdk'),
      UV_CACHE_DIR: path.join(runtimeRoot, 'cache'),
      MINERU_TOOLS_CONFIG_JSON: path.join(runtimeRoot, 'mineru.json'),
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    }
  }

  async start(onProgress) {
    if (this.child && this.apiUrl) return this.apiUrl
    if (this.starting) return this.starting
    this.starting = this.startInternal(onProgress)
    try {
      return await this.starting
    } finally {
      this.starting = undefined
    }
  }

  async startInternal(onProgress) {
    const mineruExecutable = findMineruExecutable({
      projectRoot: this.projectRoot,
      resourcesPath: this.resourcesPath,
      runtimeRoot: this.runtimeRoot,
      userDataPath: this.userDataPath,
    })
    if (!mineruExecutable) throw new Error('本地 MinerU 尚未安装。')
    const apiExecutable = path.join(path.dirname(mineruExecutable), 'mineru-api.exe')
    const port = await availablePort()
    if (!port) throw new Error('无法为本地 MinerU 分配回环端口。')
    const apiUrl = `http://127.0.0.1:${port}`
    onProgress?.({ stream: 'status', text: '正在启动本地 MinerU 服务…' })
    const child = spawn(apiExecutable, ['--host', '127.0.0.1', '--port', String(port)], {
      cwd: this.userDataPath,
      windowsHide: true,
      shell: false,
      env: this.environment(),
    })
    this.child = child
    child.stdout.on('data', chunk => onProgress?.({ stream: 'stdout', text: chunk.toString('utf8') }))
    child.stderr.on('data', chunk => onProgress?.({ stream: 'stderr', text: chunk.toString('utf8') }))
    child.on('exit', () => {
      if (this.child === child) {
        this.child = undefined
        this.apiUrl = undefined
      }
    })
    child.on('error', error => onProgress?.({ stream: 'stderr', text: error.message }))

    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`本地 MinerU 服务启动失败（退出码 ${child.exitCode}）。`)
      if (await healthCheck(apiUrl)) {
        this.apiUrl = apiUrl
        onProgress?.({ stream: 'status', text: '本地 MinerU 服务已就绪。' })
        return apiUrl
      }
      await delay(500)
    }
    child.kill()
    throw new Error('本地 MinerU 服务启动超时。')
  }

  async stop() {
    const child = this.child
    this.child = undefined
    this.apiUrl = undefined
    if (!child || child.exitCode !== null) return
    child.kill()
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      delay(5000),
    ])
    child.stdout?.destroy()
    child.stderr?.destroy()
    child.unref()
  }
}

module.exports = { MineruLocalService, availablePort, healthCheck }

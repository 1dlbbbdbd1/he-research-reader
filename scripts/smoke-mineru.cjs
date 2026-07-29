const fs = require('node:fs/promises')
const path = require('node:path')
const { parseWithMineru } = require('../electron/mineru.cjs')
const { MineruLocalService } = require('../electron/mineru-service.cjs')

async function main() {
  const projectRoot = path.join(__dirname, '..')
  const fixturePath = path.join(projectRoot, 'test-fixtures', 'pdf-render-check.pdf')
  const bytes = await fs.readFile(fixturePath)
  let latestProgress = ''
  const app = { getPath: name => {
      if (name !== 'userData') throw new Error(`Unexpected app path request: ${name}`)
      return path.join(projectRoot, '.runtime', 'bridge-user-data')
    } }
  const onProgress = progress => {
      const lines = progress.text.trim().split(/\r?\n/).filter(Boolean)
      if (lines.length) latestProgress = lines[lines.length - 1]
      if (progress.stream === 'status') console.log(progress.text)
    }
  const service = new MineruLocalService({
    projectRoot,
    resourcesPath: '',
    userDataPath: app.getPath('userData'),
  })
  let result
  try {
    const apiUrl = await service.start(onProgress)
    result = await parseWithMineru({
      app,
      projectRoot,
      resourcesPath: '',
      input: {
        taskId: `smoke-${Date.now()}`,
        fileName: path.basename(fixturePath),
        bytes,
      },
      onProgress,
      apiUrl,
    })
  } finally {
    await service.stop()
  }
  if (!result.localOnly || !result.markdown.includes('Research Workbench PDF Render Check')) {
    throw new Error('本地 MinerU 桥接返回内容不符合验收条件。')
  }
  console.log(JSON.stringify({
    localOnly: result.localOnly,
    backend: result.backend,
    markdownPath: result.markdownPath,
    outputDirectory: result.outputDirectory,
    markdownCharacters: result.markdown.length,
    latestProgress,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

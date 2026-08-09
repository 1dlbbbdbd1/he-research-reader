const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')

function bilingualSourceHash(value) {
  const normalized = String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${normalized.length}`
}

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
if (smokeMode) {
  const { WorkspaceService } = require('../electron/workspace-service.cjs')
  const smokeVaultPath = path.join(runRoot, 'vault')
  fs.mkdirSync(smokeVaultPath, { recursive: true })
  const service = new WorkspaceService({ registryPath: path.join(userDataPath, 'workspaces.json') })
  try {
    const vault = service.createAt(smokeVaultPath, '隔离桌面今日科研与结构化阅读验收')
    service.importSourceFile({
      id: 'desktop-structured-smoke',
      fileName: 'structured-smoke.pdf',
      kind: 'PDF',
      bytes: Buffer.from('%PDF-1.4 structured reading smoke'),
    })
    const markdown = 'Abstract\n\nThis is the first evidence sentence.\nSecond glued paragraph begins here.\n\nMethods\n\nRaw evidence remains traceable.'
    const source = service.loadLibraryState().sources.find(item => item.id === 'desktop-structured-smoke')
    service.syncLibraryState({
      workspaceId: vault.id,
      sources: [{
        ...source,
        status: '已解析',
        pages: 4,
        mineruState: '完成',
        mineruMarkdown: markdown,
        readerState: { viewMode: 'markdown', zoom: 1.1 },
      }],
      annotations: [],
    })
    const item = service.loadLibraryState().bibliographicItems.find(entry => entry.sourceId === 'desktop-structured-smoke')
    const translatedBase = 'This is the first evidence sentence.\nSecond glued paragraph begins here.'
    const translatedWorking = 'This is the first evidence sentence. Second glued paragraph begins here.'
    const translatedBaseHash = bilingualSourceHash(translatedBase)
    service.saveReadingTranslationSegment({
      sourceId: 'desktop-structured-smoke',
      segmentId: `segment-${translatedBaseHash.replace(/^fnv1a-/, '')}-1`,
      baseSourceHash: translatedBaseHash,
      sourceHash: bilingualSourceHash(translatedWorking),
      sourceText: translatedWorking,
      translatedText: '这是第一句证据。第二个粘连段落从这里开始。',
      provider: 'local',
      model: 'Argos en_zh',
      status: 'translated',
      attempts: 1,
    })
    const failedText = 'Raw evidence remains traceable.'
    const failedHash = bilingualSourceHash(failedText)
    service.saveReadingTranslationSegment({
      sourceId: 'desktop-structured-smoke',
      segmentId: `segment-${failedHash.replace(/^fnv1a-/, '')}-1`,
      sourceHash: failedHash,
      sourceText: failedText,
      provider: 'local',
      model: 'Argos en_zh',
      status: 'failed',
      error: '隔离烟测模拟单段失败',
      attempts: 1,
    })
    service.updateReadingState({ itemId: item.id, readingStatus: 'reading', lastPage: 2, totalPages: 4 })
    const research = service.saveResearchRun({
      id: 'desktop-active-run',
      title: '隔离装配基线复测',
      outcome: 'running',
      observations: '已完成第一组参数。',
      nextStep: '只改变接触刚度后复测',
    })
    service.saveResearchRecord({
      id: 'desktop-blocker',
      recordType: 'log',
      title: '传感器零点漂移待定位',
      content: '当前结果暂不能进入正式结论。',
      status: 'blocked',
    })
    service.createActionPack({
      title: '核对实验工况',
      objective: '确认比较条件是否一致',
      createdBy: 'ai',
      scope: { kind: 'current', label: '当前文献', itemIds: [item.id] },
      actions: [{
        actionType: 'verify',
        title: '核对刚度范围',
        rationale: '当前文献与 Run 的工况可能不一致。',
        evidence: [{
          evidenceType: 'source',
          entityId: 'desktop-structured-smoke',
          sourceId: 'desktop-structured-smoke',
          itemId: item.id,
          label: item.title,
          excerpt: 'This is the first evidence sentence.',
        }],
      }],
    })
    service.saveResearchResume({
      activeView: 'reader',
      sourceId: 'desktop-structured-smoke',
      pageNumber: 2,
      readerMode: 'markdown',
      activeRunId: research.runs.find(run => run.id === 'desktop-active-run').id,
    })
  } finally {
    service.close()
  }
}
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
let stdout = ''
child.stdout.on('data', chunk => {
  const text = chunk.toString('utf8')
  stdout += text
  process.stdout.write(text)
})
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
  const smokeFailed = smokeMode && /RESEARCH_READER_DESKTOP_SMOKE_FAILED=/.test(`${stdout}\n${stderr}`)
  const smokePassed = !smokeMode || /RESEARCH_READER_DESKTOP_SMOKE=/.test(stdout)
  if (code !== 0 || signal || gpuCrash || smokeFailed || !smokePassed) {
    process.stderr.write(`DESKTOP_TEST_FAILED=${JSON.stringify({ code, signal, gpuCrash, smokeFailed, smokePassed, runRoot })}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`DESKTOP_TEST_PASSED=${JSON.stringify({ mode, code, runRoot })}\n`)
})

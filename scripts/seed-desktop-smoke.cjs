const fs = require('node:fs')
const path = require('node:path')
const { WorkspaceService } = require('../electron/workspace-service.cjs')

const projectRoot = path.resolve(__dirname, '..')
const runRoot = path.join(projectRoot, '.reader-cache', `desktop-smoke-${Date.now()}`)
const userDataPath = path.join(runRoot, 'user-data')
const vaultPath = path.join(runRoot, 'vault')
const pdfPath = path.join(projectRoot, 'test-fixtures', 'pdf-render-check.pdf')
const mineruRoot = path.join(projectRoot, '.runtime', 'smoke-output-20260729-2')
const markdownPath = path.join(mineruRoot, 'pdf-render-check', 'auto', 'pdf-render-check.md')

for (const requiredPath of [pdfPath, mineruRoot, markdownPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`桌面回归缺少既有测试产物：${requiredPath}`)
}

fs.mkdirSync(userDataPath, { recursive: true })
fs.mkdirSync(vaultPath, { recursive: true })
const service = new WorkspaceService({ registryPath: path.join(userDataPath, 'workspaces.json') })
try {
  const vault = service.createAt(vaultPath, '桌面阅读回归测试库')
  const bytes = fs.readFileSync(pdfPath)
  const crypto = require('node:crypto')
  const contentSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  service.importSourceFile({
    id: 'desktop-smoke-pdf',
    fileName: 'pdf-render-check.pdf',
    kind: 'PDF',
    version: 1,
    contentSha256,
    bytes,
  })
  service.syncLibraryState({
    workspaceId: vault.id,
    sources: [{
      id: 'desktop-smoke-pdf',
      fileId: 'desktop-smoke-pdf',
      name: 'pdf-render-check.pdf',
      kind: 'PDF',
      version: 1,
      status: '已解析',
      pages: 2,
      hash: contentSha256,
      extractedText: [
        '# Page 1',
        'Research Workbench PDF Render Check',
        'Hypothesis: online identification reduces peak contact force.',
        'Evidence status: requires a fixed-parameter baseline.',
        'This document is a local rendering test for the PDF reader.',
        '# Page 2',
        'Page 2: Traceability',
        'Citation anchor: p. 2, local rendering verification.',
      ].join('\n\n'),
    }],
    annotations: [],
  })
  const markdown = fs.readFileSync(markdownPath, 'utf8')
  const persisted = service.persistMineruResult({
    taskId: 'desktop-smoke-mineru',
    sourceId: 'desktop-smoke-pdf',
    outputDirectory: mineruRoot,
    markdownPath,
    markdown,
    backend: 'pipeline',
  })
  process.stdout.write(`DESKTOP_SMOKE_RESULT=${JSON.stringify({
    runRoot,
    userDataPath,
    vaultPath,
    workspaceId: vault.id,
    sourceId: 'desktop-smoke-pdf',
    mineruRevision: persisted.revision,
  })}\n`)
} finally {
  service.close()
}

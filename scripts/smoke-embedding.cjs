const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  embedLocally,
  localEmbeddingStatus,
} = require('../electron/local-embedding.cjs')
const { reciprocalRankFusion } = require('../electron/semantic-index.cjs')
const { WorkspaceService } = require('../electron/workspace-service.cjs')

async function main() {
  const projectRoot = path.resolve(__dirname, '..')
  const runtimeRoot = path.join(projectRoot, '.runtime', 'embedding')
  const options = {
    projectRoot,
    runtimeRoot,
    bridgeScript: path.join(projectRoot, 'scripts', 'embedding-bridge.py'),
  }
  const status = await localEmbeddingStatus(options)
  if (!status.available || status.dimension !== 512) throw new Error(status.message || '本地语义模型未就绪。')
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'research-reader-semantic-smoke-'))
  const service = new WorkspaceService({ registryPath: path.join(smokeRoot, 'app-data', 'workspaces.json') })
  try {
    const vault = service.create(smokeRoot, '语义索引冒烟')
    const fixtures = [
      ['relevant-source', 'adaptive-assembly.pdf', '在线辨识接触刚度并调整阻抗参数，可以降低装配过程中的峰值接触力。'],
      ['unrelated-source', 'tomato-irrigation.pdf', '本研究讨论温室番茄灌溉时间对果实糖度的影响。'],
    ]
    for (const [id, fileName] of fixtures) {
      const bytes = Buffer.from(`%PDF-${id}`)
      service.importSourceFile({
        id,
        fileName,
        kind: 'PDF',
        contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        bytes,
      })
    }
    const sources = service.loadLibraryState().sources
    for (const [id, , text] of fixtures) {
      const source = sources.find(entry => entry.id === id)
      source.status = '已解析'
      source.extractedText = text
    }
    service.syncLibraryState({
      workspaceId: vault.id,
      sources,
      annotations: [{
        id: 'semantic-smoke-annotation',
        sourceId: 'relevant-source',
        text: '接触力峰值随阻抗参数调整而降低。',
        note: '可用于柔顺装配方法对比。',
        category: '试验方法',
        page: '第 3 页',
        anchor: {
          type: 'pdf',
          state: 'resolved',
          pageNumber: 3,
          rects: [{ x: 0.12, y: 0.25, width: 0.3, height: 0.04 }],
        },
      }],
    })
    const prepared = service.prepareSemanticIndex({ model: status.model })
    const passages = await embedLocally({
      ...options,
      kind: 'passage',
      texts: prepared.documents.map(document => document.text),
    })
    const index = service.commitSemanticIndex({
      model: status.model,
      dimension: status.dimension,
      sourceIndexedAt: prepared.sourceIndexedAt,
      documents: prepared.documents,
      vectors: passages.vectors,
    })
    const question = '装配过程中怎样降低接触力峰值？'
    const query = await embedLocally({ ...options, kind: 'query', texts: [question] })
    const semantic = service.searchSemanticIndex({
      model: status.model,
      vector: query.vectors[0],
      limit: 20,
    })
    const relevantScores = semantic.results.filter(result => result.itemId === 'item:relevant-source').map(result => result.semanticScore)
    const unrelatedScores = semantic.results.filter(result => result.itemId === 'item:unrelated-source').map(result => result.semanticScore)
    const relevantScore = Math.max(...relevantScores)
    const unrelatedScore = Math.max(...unrelatedScores)
    if (!(relevantScore > unrelatedScore)) throw new Error('研究库语义索引没有把相关论文排在无关论文之前。')
    const annotation = semantic.results.find(result => result.origin === 'user')
    if (annotation?.pageNumber !== 3 || annotation?.anchor?.rects?.length !== 1) {
      throw new Error('研究库语义索引没有保留批注页码和原文矩形。')
    }
    const exact = service.searchLibrary({ query: '接触力', limit: 20 })
    const fused = reciprocalRankFusion(exact.results, semantic.results, 12)
    if (!fused.some(result => result.channels.includes('exact') && result.channels.includes('semantic'))) {
      throw new Error('精确检索与语义检索没有融合重复证据。')
    }
    console.log(JSON.stringify({
      status,
      index: { ready: index.ready, chunkCount: index.chunkCount },
      relevantScore: Number(relevantScore.toFixed(6)),
      unrelatedScore: Number(unrelatedScore.toFixed(6)),
      topResult: semantic.results[0]?.title,
      annotationPage: annotation.pageNumber,
      hybridChannels: fused[0]?.channels,
      offline: true,
    }, null, 2))
  } finally {
    service.close()
    fs.rmSync(smokeRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

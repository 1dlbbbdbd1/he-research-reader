const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const {
  candidatePythonExecutables,
  checkedTexts,
  embeddingEnvironment,
  parseBridgeResult,
} = require('../electron/local-embedding.cjs')

test('本地嵌入运行时只从显式项目或用户数据路径寻找 Python', () => {
  const candidates = candidatePythonExecutables({
    projectRoot: 'E:\\reader',
    runtimeRoot: 'D:\\semantic-runtime',
    userDataPath: 'C:\\ReaderUser',
  })
  assert.ok(candidates.includes(path.join('D:\\semantic-runtime', 'fastembed', '.venv', 'Scripts', 'python.exe')))
  assert.ok(candidates.includes(path.join('C:\\ReaderUser', 'embedding-runtime', 'fastembed', '.venv', 'Scripts', 'python.exe')))
  assert.ok(candidates.includes(path.join('E:\\reader', '.runtime', 'embedding', 'fastembed', '.venv', 'Scripts', 'python.exe')))
})

test('嵌入桥接限制批量大小和单条字符数', () => {
  assert.deepEqual(checkedTexts(['  evidence  ', '用户笔记']), ['evidence', '用户笔记'])
  assert.throws(() => checkedTexts([]), /1–128/)
  assert.throws(() => checkedTexts(['x'.repeat(8001)]), /8000/)
})

test('嵌入环境把模型、缓存和清单限制在选择的运行目录', () => {
  const environment = embeddingEnvironment('D:\\reader-semantic')
  assert.equal(environment.FASTEMBED_CACHE_PATH, path.join('D:\\reader-semantic', 'models'))
  assert.equal(environment.READER_EMBEDDING_MANIFEST, path.join('D:\\reader-semantic', 'embedding-manifest.json'))
  assert.equal(environment.HF_HUB_OFFLINE, '1')
})

test('嵌入桥接只接受明确结果标记', () => {
  const result = parseBridgeResult('noise\nREADER_EMBEDDING_RESULT:{"ok":true,"result":{"dimension":512}}\n')
  assert.equal(result.dimension, 512)
  assert.throws(() => parseBridgeResult('{"ok":true}'), /没有返回有效结果/)
})

test('嵌入安装脚本锁定 FastEmbed 与中文小模型', () => {
  const setup = require('node:fs').readFileSync(path.join(__dirname, '..', 'scripts', 'setup-embedding.ps1'), 'utf8')
  const bridge = require('node:fs').readFileSync(path.join(__dirname, '..', 'scripts', 'embedding-bridge.py'), 'utf8')
  assert.match(setup, /fastembed==0\.8\.0/)
  assert.match(setup, /BAAI\/bge-small-zh-v1\.5/)
  assert.match(bridge, /local_files_only=True/)
  assert.match(bridge, /MAX_TEXTS = 128/)
})

test('桌面桥接和安装包只暴露受限本地嵌入接口与必需脚本', () => {
  const main = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const preload = require('node:fs').readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
  const packageJson = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const resources = packageJson.build.extraResources.map(resource => resource.from)
  assert.match(main, /ipcMain\.handle\('embedding:status'/)
  assert.match(main, /ipcMain\.handle\('embedding:install'/)
  assert.match(main, /ipcMain\.handle\('embedding:embed'/)
  assert.match(main, /ipcMain\.handle\('workspace:semantic-rebuild'/)
  assert.match(main, /ipcMain\.handle\('workspace:hybrid-search'/)
  assert.match(main, /reciprocalRankFusion/)
  assert.match(preload, /getLocalEmbeddingStatus/)
  assert.match(preload, /searchWorkspaceHybrid/)
  assert.match(preload, /onWorkspaceSemanticProgress/)
  assert.ok(resources.includes('scripts/setup-embedding.ps1'))
  assert.ok(resources.includes('scripts/embedding-bridge.py'))
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { PluginService, validateManifest } = require('../electron/plugins/plugin-service.cjs')

const manifestRoot = path.join(__dirname, '..', 'plugins')

test('插件注册表读取六个可信内置插件并保留默认安装状态', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-service-'))
  try {
    const service = new PluginService({ manifestRoot, statePath: path.join(root, 'plugins.json') })
    const plugins = service.list()
    assert.deepEqual(plugins.map(plugin => plugin.id), ['arxiv', 'github', 'latex', 'llm', 'translation', 'zotero'])
    assert.deepEqual(plugins.filter(plugin => plugin.installed).map(plugin => plugin.id), ['latex', 'llm', 'translation', 'zotero'])
    assert.ok(plugins.every(plugin => plugin.trust === 'built-in' && plugin.interfaceVersion === 1))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('插件可安装、卸载并在重启后保留，能力调用必须经过安装门', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-service-'))
  const statePath = path.join(root, 'plugins.json')
  try {
    let service = new PluginService({ manifestRoot, statePath })
    assert.equal(service.install({ id: 'arxiv' }).installed, true)
    assert.equal(service.uninstall({ id: 'latex' }).installed, false)
    service = new PluginService({ manifestRoot, statePath })
    assert.equal(service.list().find(plugin => plugin.id === 'arxiv').installed, true)
    assert.equal(service.list().find(plugin => plugin.id === 'latex').installed, false)
    assert.throws(() => service.requireCapability('latex', 'writing.latex-package'), /未安装/)
    assert.equal(service.requireCapability('arxiv', 'paper.search').id, 'arxiv')
    assert.throws(() => service.install({ id: 'remote-unknown' }), /只能安装/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('manifest 拒绝目录 ID 不一致、任意权限和非内置信任', () => {
  const base = { id: 'safe-plugin', name: 'Safe', version: '1', category: 'writing', interfaceVersion: 1, trust: 'built-in', adapter: 'safe', capabilities: [], permissions: [] }
  assert.throws(() => validateManifest({ ...base, id: 'other' }, 'safe-plugin'), /ID 不一致/)
  assert.throws(() => validateManifest({ ...base, permissions: ['filesystem:all'] }, 'safe-plugin'), /未定义权限/)
  assert.throws(() => validateManifest({ ...base, trust: 'remote' }, 'safe-plugin'), /不是可信内置/)
})

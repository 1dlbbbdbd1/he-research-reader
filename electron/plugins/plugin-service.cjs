const fs = require('node:fs')
const path = require('node:path')

const PLUGIN_CATEGORIES = new Set(['bibliography', 'discovery', 'code', 'writing', 'translation', 'llm'])
const PLUGIN_PERMISSIONS = new Set(['bibliography:read', 'bibliography:write', 'network:arxiv', 'network:github', 'files:export', 'translation:local', 'llm:invoke'])
const PLUGIN_INTERFACE_VERSION = 1

function safeJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return fallback }
}

function validateManifest(value, directoryName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`插件 ${directoryName} 的 manifest 无效。`)
  const id = String(value.id || '').trim()
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(id) || id !== directoryName) throw new Error(`插件目录 ${directoryName} 与插件 ID 不一致。`)
  const category = String(value.category || '')
  if (!PLUGIN_CATEGORIES.has(category)) throw new Error(`插件 ${id} 的类别无效。`)
  if (Number(value.interfaceVersion) !== PLUGIN_INTERFACE_VERSION) throw new Error(`插件 ${id} 的接口版本不兼容。`)
  if (value.trust !== 'built-in') throw new Error(`插件 ${id} 不是可信内置插件，已拒绝加载。`)
  const permissions = Array.isArray(value.permissions) ? [...new Set(value.permissions.map(String))] : []
  if (permissions.some(permission => !PLUGIN_PERMISSIONS.has(permission))) throw new Error(`插件 ${id} 请求了未定义权限。`)
  const capabilities = Array.isArray(value.capabilities) ? [...new Set(value.capabilities.map(item => String(item).trim()).filter(Boolean))] : []
  return {
    id,
    name: String(value.name || id).trim().slice(0, 120),
    version: String(value.version || '1.0.0').trim().slice(0, 40),
    description: String(value.description || '').trim().slice(0, 1000),
    category,
    interfaceVersion: PLUGIN_INTERFACE_VERSION,
    trust: 'built-in',
    adapter: String(value.adapter || id).trim().slice(0, 80),
    capabilities,
    permissions,
    defaultInstalled: Boolean(value.defaultInstalled),
  }
}

class PluginService {
  constructor({ manifestRoot, statePath }) {
    this.manifestRoot = path.resolve(manifestRoot)
    this.statePath = path.resolve(statePath)
    this.manifests = this.#loadManifests()
  }

  #loadManifests() {
    const manifests = new Map()
    if (!fs.existsSync(this.manifestRoot)) return manifests
    for (const entry of fs.readdirSync(this.manifestRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || !/^[a-z][a-z0-9-]{1,62}$/.test(entry.name)) continue
      const manifestPath = path.join(this.manifestRoot, entry.name, 'plugin.json')
      if (!fs.existsSync(manifestPath) || fs.statSync(manifestPath).size > 64 * 1024) continue
      const manifest = validateManifest(safeJson(manifestPath, null), entry.name)
      if (manifests.has(manifest.id)) throw new Error(`插件 ID 重复：${manifest.id}`)
      manifests.set(manifest.id, manifest)
    }
    return manifests
  }

  #state() {
    const saved = safeJson(this.statePath, {})
    const explicit = Array.isArray(saved.installed) ? saved.installed.filter(id => this.manifests.has(id)) : undefined
    return { version: 1, installed: explicit ?? [...this.manifests.values()].filter(plugin => plugin.defaultInstalled).map(plugin => plugin.id) }
  }

  #save(state) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true })
    const temporary = `${this.statePath}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, installed: [...new Set(state.installed)].sort() }, null, 2), 'utf8')
    fs.renameSync(temporary, this.statePath)
  }

  list() {
    const installed = new Set(this.#state().installed)
    return [...this.manifests.values()].map(plugin => ({ ...plugin, installed: installed.has(plugin.id) }))
  }

  install(input = {}) {
    const id = String(input.id || '').trim()
    const plugin = this.manifests.get(id)
    if (!plugin) throw new Error('只能安装随应用发布并通过签名发布流程审计的内置插件。')
    const state = this.#state()
    if (!state.installed.includes(id)) { state.installed.push(id); this.#save(state) }
    return this.list().find(item => item.id === id)
  }

  uninstall(input = {}) {
    const id = String(input.id || '').trim()
    if (!this.manifests.has(id)) throw new Error('插件不存在。')
    const state = this.#state()
    state.installed = state.installed.filter(item => item !== id)
    this.#save(state)
    return this.list().find(item => item.id === id)
  }

  requireCapability(pluginId, capability) {
    const plugin = this.list().find(item => item.id === pluginId && item.installed)
    if (!plugin || !plugin.capabilities.includes(capability)) throw new Error(`插件 ${pluginId} 未安装或不提供 ${capability}。`)
    return plugin
  }
}

module.exports = { PLUGIN_INTERFACE_VERSION, PLUGIN_PERMISSIONS, PluginService, validateManifest }

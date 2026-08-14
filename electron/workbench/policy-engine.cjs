const fs = require('node:fs')
const path = require('node:path')

const HIGH_RISK_PATTERNS = [
  /\b(remove-item|del|erase|rmdir|format|diskpart)\b/i,
  /\bgit\s+(push|tag)\b/i,
  /\b(gh\s+(pr|release)|npm\s+publish)\b/i,
  /\b(install-package|winget\s+install|choco\s+install)\b/i,
]

function list(value, maximum = 100) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, maximum) : []
}

function nearestExisting(value) {
  let current = path.resolve(value)
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return current
}

function canonical(value) {
  const resolved = path.resolve(String(value || ''))
  const existing = nearestExisting(resolved)
  if (!existing) throw new Error('路径没有可验证的现有父目录。')
  const real = fs.realpathSync.native(existing)
  return path.join(real, path.relative(existing, resolved))
}

function within(candidate, root) {
  const relative = path.relative(canonical(root), canonical(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeGrant(input = {}) {
  return {
    readRoots: list(input.readRoots),
    writeRoots: list(input.writeRoots),
    domains: list(input.domains).map(value => value.toLowerCase()),
    commands: list(input.commands),
    commandPrefixes: list(input.commandPrefixes),
    applications: list(input.applications),
    allowModelFileContent: Boolean(input.allowModelFileContent),
    allowScreenshots: Boolean(input.allowScreenshots),
  }
}

class PolicyEngine {
  normalizeGrant(input) { return normalizeGrant(input) }

  requirePath(grantInput, candidate, mode = 'read') {
    const grant = normalizeGrant(grantInput)
    const roots = mode === 'write' ? grant.writeRoots : [...grant.readRoots, ...grant.writeRoots]
    if (!roots.some(root => within(candidate, root))) throw new Error(`未授权${mode === 'write' ? '写入' : '读取'}这个路径。`)
    return canonical(candidate)
  }

  requireUrl(grantInput, value) {
    const grant = normalizeGrant(grantInput)
    let url
    try { url = new URL(String(value || '')) } catch { throw new Error('网页地址无效。') }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('只允许访问 HTTP 或 HTTPS 网页。')
    const host = url.hostname.toLowerCase()
    if (!grant.domains.some(domain => host === domain || host.endsWith(`.${domain}`))) throw new Error('这个网站不在本次任务授权范围内。')
    return url
  }

  requireCommand(grantInput, executableValue, argsValue, cwdValue) {
    const grant = normalizeGrant(grantInput)
    const executable = String(executableValue || '').trim()
    const args = list(argsValue, 200)
    if (!executable || !grant.commands.some(command => command.toLowerCase() === executable.toLowerCase() || path.basename(command).toLowerCase() === path.basename(executable).toLowerCase())) {
      throw new Error('这个程序不在本次任务授权范围内。')
    }
    const serialized = [executable, ...args].join(' ')
    if (grant.commandPrefixes.length && !grant.commandPrefixes.some(prefix => serialized.toLowerCase().startsWith(prefix.toLowerCase()))) throw new Error('命令参数超出授权前缀。')
    const cwd = this.requirePath(grant, cwdValue, 'write')
    return { executable, args, cwd, highRisk: HIGH_RISK_PATTERNS.some(pattern => pattern.test(serialized)) }
  }

  requireApplication(grantInput, application) {
    const grant = normalizeGrant(grantInput)
    const normalized = String(application || '').trim().toLowerCase()
    if (!grant.applications.some(value => value.toLowerCase() === normalized)) throw new Error('这个应用不在本次任务授权范围内。')
    return normalized
  }

  classify(input = {}) {
    const kind = String(input.kind || '')
    const summary = String(input.summary || '')
    const alwaysConfirm = ['delete', 'move-original', 'external-submit', 'upload', 'publish', 'payment', 'install', 'elevate', 'formal-record', 'cross-application']
    return { highRisk: alwaysConfirm.includes(kind) || HIGH_RISK_PATTERNS.some(pattern => pattern.test(summary)), kind }
  }
}

module.exports = { PolicyEngine, canonical, normalizeGrant, within }

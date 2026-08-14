const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { PolicyEngine } = require('../electron/workbench/policy-engine.cjs')
const { ToolRegistry } = require('../electron/workbench/tool-registry.cjs')

test('路径、域名与命令均被任务授权边界约束', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-policy-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const policy = new PolicyEngine()
  const grant = { readRoots: [root], writeRoots: [root], domains: ['example.com'], commands: [process.execPath], commandPrefixes: [process.execPath] }
  assert.equal(policy.requirePath(grant, path.join(root, 'nested', 'file.txt'), 'write').startsWith(root), true)
  assert.throws(() => policy.requirePath(grant, path.join(root, '..', 'outside.txt'), 'write'), /未授权/)
  assert.equal(policy.requireUrl(grant, 'https://docs.example.com/a').hostname, 'docs.example.com')
  assert.throws(() => policy.requireUrl(grant, 'https://example.org'), /授权范围/)
  assert.equal(policy.requireCommand(grant, process.execPath, ['--version'], root).highRisk, false)
  assert.throws(() => policy.requireCommand(grant, 'cmd.exe', ['/c', 'echo'], root), /不在本次任务授权/)
})

test('文件写入产生新版本且不会覆盖原件', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-file-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const original = path.join(root, 'report.md')
  fs.writeFileSync(original, 'original', 'utf8')
  const policy = new PolicyEngine()
  const tools = new ToolRegistry({ policyEngine: policy, fetchImpl: globalThis.fetch, desktopAdapter: {}, officeScriptPath: '' })
  const result = await tools.execute('file.writeVersioned', { path: original, content: 'agent' }, { writeRoots: [root] })
  assert.equal(fs.readFileSync(original, 'utf8'), 'original')
  assert.equal(fs.readFileSync(result.path, 'utf8'), 'agent')
  assert.match(path.basename(result.path), /report\.agent-1\.md/)
})

test('删除、发布、付款和跨应用动作永远判为高风险', () => {
  const policy = new PolicyEngine()
  for (const kind of ['delete', 'publish', 'payment', 'external-submit', 'formal-record', 'cross-application']) assert.equal(policy.classify({ kind }).highRisk, true)
  assert.equal(policy.classify({ kind: 'command', summary: 'git push origin main' }).highRisk, true)
})

test('高风险命令只有在主进程收到批准证据后才执行', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-command-confirm-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const policy = new PolicyEngine()
  const tools = new ToolRegistry({ policyEngine: policy, fetchImpl: globalThis.fetch, desktopAdapter: {}, officeScriptPath: '' })
  const input = { executable: process.execPath, args: ['-e', 'process.stdout.write("git push approval consumed")'], cwd: root }
  const grant = { writeRoots: [root], commands: [process.execPath], commandPrefixes: [process.execPath] }
  const blocked = await tools.execute('command.run', input, grant)
  assert.equal(blocked.requiresHighRiskConfirmation, true)
  const executed = await tools.execute('command.run', input, grant, { highRiskApproved: true })
  assert.equal(executed.exitCode, 0)
  assert.equal(executed.stdout, 'git push approval consumed')
})

test('桌面键鼠动作在执行前必须二次确认且不会提前捕获窗口', async () => {
  const policy = new PolicyEngine()
  let captureCount = 0
  const desktopAdapter = {
    async captureWindow() {
      captureCount += 1
      return { title: '受控测试窗口', imageDataUrl: 'data:image/png;base64,AA==' }
    },
  }
  const tools = new ToolRegistry({ policyEngine: policy, desktopAdapter, officeScriptPath: '', desktopInputScriptPath: '' })
  const result = await tools.execute('desktop.performAction', {
    application: 'controlled-test',
    sourceId: 'window:123:0',
    expectedTitle: '受控测试窗口',
    action: { type: 'click', x: 20, y: 20 },
  }, { applications: ['controlled-test'], allowScreenshots: true })
  assert.equal(result.requiresHighRiskConfirmation, true)
  assert.equal(captureCount, 0)
})

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = require('docx')
const { PolicyEngine } = require('../electron/workbench/policy-engine.cjs')
const { ToolRegistry } = require('../electron/workbench/tool-registry.cjs')
const { WorkbenchService } = require('../electron/workbench/workbench-service.cjs')
const { WorkspaceService } = require('../electron/workspace-service.cjs')

function hash(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') }

async function main() {
  const projectRoot = path.resolve(__dirname, '..')
  const runRoot = path.join(projectRoot, '.reader-cache', `word-formatting-smoke-${Date.now()}-${process.pid}`)
  fs.mkdirSync(runRoot, { recursive: true })
  const vaultRoot = path.join(runRoot, 'vault')
  const workspace = new WorkspaceService({ registryPath: path.join(runRoot, 'registry.json') })
  const vault = workspace.createAt(vaultRoot, 'Word 排版隔离验收')
  const sourcePath = path.join(vaultRoot, 'original-sample.docx')
  const outputPath = path.join(vaultRoot, 'formatted-sample.docx')
  const reportPath = path.join(vaultRoot, 'formatting-qa.md')
  const document = new Document({ sections: [{ children: [
    new Paragraph({ text: 'Robot Safety Study', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun('This synthetic document verifies versioned Word formatting without private research content.')] }),
    new Paragraph({ text: 'Method', heading: HeadingLevel.HEADING_2 }),
    new Paragraph('We inspect the original read-only, create a new formatted copy, repaginate it, and preserve the original hash.'),
    new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Metric')] }), new TableCell({ children: [new Paragraph('Value')] })] }), new TableRow({ children: [new TableCell({ children: [new Paragraph('Original unchanged')] }), new TableCell({ children: [new Paragraph('Required')] })] })] }),
  ] }] })
  fs.writeFileSync(sourcePath, await Packer.toBuffer(document))
  const sourceSha256 = hash(sourcePath)
  const policy = new PolicyEngine()
  const tools = new ToolRegistry({
    policyEngine: policy,
    desktopAdapter: {},
    officeScriptPath: path.join(projectRoot, 'scripts', 'office-create-copy.ps1'),
    wordWorkflowScriptPath: path.join(projectRoot, 'scripts', 'office-word-workflow.ps1'),
    wordProbe: () => true,
    workspaceService: workspace,
  })
  const service = new WorkbenchService({ workspaceService: workspace, toolRegistry: tools, policyEngine: policy, llmService: { complete: async () => ({ content: '{}', providerId: 'smoke', model: 'none' }) }, settingsStore: { loadModelRoleConfig: () => ({}) } })
  service.setCapabilityPack({ id: 'research-document-formatting', enabled: true })
  let run = service.createRun({ objective: '真实执行 Word 一键规范排版隔离验收', capabilityPack: 'research-document-formatting', capabilityInput: { sourcePath, outputPath, reportPath, template: { bodyFontEastAsia: '宋体', bodyFontLatin: 'Times New Roman', bodyFontSizePt: 11, lineSpacing: 1.5, firstLineChars: 2, marginsCm: { top: 2.5, bottom: 2.5, left: 3, right: 2.5 }, pageNumbers: true } } })
  run = service.authorizeRun({ runId: run.id, scope: { readRoots: [vaultRoot], writeRoots: [vaultRoot], applications: ['word'] } })
  for (let guard = 0; guard < 30 && run.status !== 'completed'; guard += 1) {
    if (run.status === 'waiting_human') {
      for (const result of run.results.filter(item => item.reviewState !== 'confirmed')) run = service.saveResult({ runId: run.id, resultId: result.id, content: result.content, reviewState: 'confirmed' })
      const pending = run.decisions.find(decision => decision.status === 'pending')
      if (!pending) break
      run = service.resolveDecision({ decisionId: pending.id, approved: true })
    } else if (run.status === 'running') run = await service.executeNext(run.id)
    else break
  }
  const inspection = run.steps.find(step => step.input._workflowStepId === 'inspect-word')?.output || {}
  const formatted = run.steps.find(step => step.input._workflowStepId === 'format-word')?.output || {}
  const qa = run.steps.find(step => step.input._workflowStepId === 'qa-word')?.output || {}
  const result = {
    runRoot,
    sourcePath,
    outputPath: formatted.path,
    reportPath: qa.path,
    sourceSha256,
    sourceSha256After: hash(sourcePath),
    originalUnchanged: sourceSha256 === hash(sourcePath) && formatted.originalUnchanged === true,
    run: { id: run.id, status: run.status, fixedWorkflow: !run.steps.some(step => step.kind === 'model'), resultCount: run.results.length, confirmedResultCount: run.results.filter(item => item.reviewState === 'confirmed').length, artifactCount: run.artifacts.length },
    inspection: { startedFromCopy: inspection.startedFromCopy, originalOpenedByWord: inspection.originalOpenedByWord, workingCopyHashMatches: inspection.workingCopyHashMatches, openedReadOnly: inspection.openedReadOnly, pageCount: inspection.pageCount, headingCount: inspection.headingCount, tableCount: inspection.tableCount },
    formatting: { startedFromCopy: formatted.startedFromCopy, originalOpenedByWord: formatted.originalOpenedByWord, workingCopyHashMatches: formatted.workingCopyHashMatches, changeCount: formatted.changes?.length || 0, pageCount: formatted.pageCount, outputSha256: formatted.sha256 },
    qa: { startedFromCopy: qa.startedFromCopy, originalOpenedByWord: qa.originalOpenedByWord, workingCopyHashMatches: qa.workingCopyHashMatches, openedReadOnly: qa.openedReadOnly, repaginated: qa.repaginated, passed: qa.passed, anomalyCount: qa.anomalyCount },
  }
  const copySafety = [inspection, formatted, qa].every(item => item.startedFromCopy === true && item.originalOpenedByWord === false && item.workingCopyHashMatches === true)
  if (run.status !== 'completed' || run.steps.some(step => step.kind === 'model') || run.results.length < 2 || run.results.some(item => item.reviewState !== 'confirmed') || !result.originalUnchanged || !copySafety || !fs.existsSync(formatted.path) || !fs.existsSync(qa.path) || !qa.repaginated || !qa.passed) throw new Error(`WORD_FORMATTING_SMOKE_FAILED=${JSON.stringify(result)}`)
  process.stdout.write(`WORD_FORMATTING_SMOKE=${JSON.stringify(result)}\n`)
  workspace.close()
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : error}\n`); process.exitCode = 1 })

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const { METHOD_SCHEMAS } = require('../electron/workbench/causal-tools.cjs')

const pythonPath = process.env.READER_RESEARCH_PYTHON || path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
const hasResearchPython = fs.existsSync(pythonPath)
const scriptPath = path.join(__dirname, '..', 'scripts', 'causal-analysis.py')

function csv(rows) {
  const headers = Object.keys(rows[0])
  return `${headers.join(',')}\n${rows.map(row => headers.map(header => row[header]).join(',')).join('\n')}\n`
}

function execute(root, name, method, design, rows) {
  const dataPath = path.join(root, `${name}.csv`); fs.writeFileSync(dataPath, csv(rows))
  const payload = Buffer.from(JSON.stringify({ dataPath, method, design }), 'utf8').toString('base64')
  const result = spawnSync(pythonPath, [scriptPath, '--payload-base64', payload], { encoding: 'utf8', windowsHide: true, timeout: 120000 })
  const marker = result.stdout.split(/\r?\n/).find(line => line.startsWith('READER_CAUSAL_RESULT:'))
  assert.ok(marker, result.stderr || result.stdout)
  const parsed = JSON.parse(marker.slice('READER_CAUSAL_RESULT:'.length))
  assert.equal(parsed.error, undefined, parsed.error)
  assert.equal(result.status, 0)
  return parsed
}

test('DID、RDD、IV、PSM、SCM 都有独立字段合同和对应诊断，并在真实 Python 环境运行', { skip: !hasResearchPython && '本机没有 READER_RESEARCH_PYTHON 或默认 Codex 因果分析 Python 运行时' }, () => {
  assert.equal(fs.existsSync(pythonPath), true)
  assert.deepEqual(Object.keys(METHOD_SCHEMAS), ['DID', 'RDD', 'IV', 'PSM', 'SCM'])
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'causal-methods-'))
  try {
    const didRows = []
    for (const treated of [0, 1]) for (let time = 0; time < 4; time += 1) didRows.push({ unit: treated ? 'T' : 'C', time, treated, post: time >= 2 ? 1 : 0, outcome: 10 + treated * 10 + time + (treated && time >= 2 ? 3 : 0) })
    const did = execute(root, 'did', 'DID', { outcome: 'outcome', unit: 'unit', time: 'time', treated: 'treated', post: 'post', covariates: [], parallelTrendThreshold: 0.1 }, didRows)
    assert.ok(did.diagnostics.parallelTrends)

    const rddRows = Array.from({ length: 101 }, (_, index) => { const running = index - 50; return { running, outcome: 10 + running * 0.1 + (running >= 0 ? 5 : 0) + (index % 3) * 0.01 } })
    const rdd = execute(root, 'rdd', 'RDD', { outcome: 'outcome', running: 'running', cutoff: 0, bandwidth: 20, covariates: [] }, rddRows)
    assert.ok(rdd.diagnostics.bandwidthSensitivity.estimates.length === 3)

    const ivRows = Array.from({ length: 120 }, (_, index) => { const instrument = index % 2; const disturbance = (index % 7 - 3) * 0.04; const treatment = 1 + 2 * instrument + disturbance; return { instrument, treatment, outcome: 4 + 3 * treatment + (index % 5 - 2) * 0.03 } })
    const iv = execute(root, 'iv', 'IV', { outcome: 'outcome', treatment: 'treatment', instrument: 'instrument', covariates: [], weakInstrumentFThreshold: 10 }, ivRows)
    assert.ok(iv.diagnostics.weakInstrument.firstStageF > 10)

    const psmRows = []
    for (let index = 0; index < 60; index += 1) { const covariate = index % 10; psmRows.push({ treatment: 0, covariate, outcome: 5 + covariate * 0.5 + (index % 3) * 0.01 }); psmRows.push({ treatment: 1, covariate: covariate + 0.2, outcome: 7 + (covariate + 0.2) * 0.5 + (index % 3) * 0.01 }) }
    const psm = execute(root, 'psm', 'PSM', { outcome: 'outcome', treatment: 'treatment', covariates: ['covariate'], balanceThreshold: 0.1 }, psmRows)
    assert.ok(psm.diagnostics.matchingBalance.smdAfter.length === 1)

    const scmRows = []
    for (let time = 0; time < 6; time += 1) {
      const a = 10 + time; const b = 20 + 2 * time
      scmRows.push({ unit: 'A', time, outcome: a }, { unit: 'B', time, outcome: b }, { unit: 'T', time, outcome: 0.5 * a + 0.5 * b + (time >= 3 ? 4 : 0) })
    }
    const scm = execute(root, 'scm', 'SCM', { outcome: 'outcome', unit: 'unit', time: 'time', treatedUnit: 'T', interventionTime: 3, preRmspeThreshold: 0.25 }, scmRows)
    assert.ok(scm.diagnostics.syntheticControl.donorWeights)

    for (const result of [did, rdd, iv, psm, scm]) {
      assert.ok(result.runtime.python)
      assert.ok(result.runtime.numpy)
      assert.ok(result.dataSha256)
      assert.ok(result.modelParameters)
      assert.match(result.interpretationBoundary, /诊断未通过时不得表述为可靠因果结论/)
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { compileLatexPackage, markdownToLatex, renderLatexDocument } = require('../electron/writing-export.cjs')

test('Markdown 到 LaTeX 保留层级、列表与代码并转义正文特殊字符', () => {
  const latex = markdownToLatex('# 结果 & 讨论\n\n- 成功率 92%\n- 保留 $x$\n\n```python\nprint("ok")\n```')
  assert.match(latex, /\\section\{结果 \\& 讨论\}/)
  assert.match(latex, /\\begin\{itemize\}/)
  assert.match(latex, /成功率 92\\%/)
  assert.match(latex, /\\begin\{verbatim\}/)
})

test('LaTeX 文档包含中文支持、参考文献数据库与可编辑正文', () => {
  const tex = renderLatexDocument({ title: '柔顺装配研究', markdown: '## 方法\n\n正文。' })
  assert.match(tex, /\\usepackage\[UTF8\]\{ctex\}/)
  assert.match(tex, /\\subsection\{方法\}/)
  assert.match(tex, /\\bibliography\{references\}/)
})

test('没有 Tectonic 时明确降级为可编辑包而不假装生成 PDF', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-export-test-'))
  try {
    fs.writeFileSync(path.join(directory, 'main.tex'), '\\documentclass{article}')
    const result = compileLatexPackage({ directory, tectonicPath: 'missing-tectonic.exe', spawn: () => ({ status: 1, error: new Error('missing') }) })
    assert.equal(result.compiled, false)
    assert.match(result.reason, /未找到 Tectonic/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

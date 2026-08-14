const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function latexEscape(value) {
  return String(value || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%$#&_{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
}

function inlineLatex(value) {
  return latexEscape(value)
    .replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '\\emph{$1}')
    .replace(/`([^`]+)`/g, '\\texttt{$1}')
}

function markdownToLatex(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
  const output = []
  let listType
  const closeList = () => {
    if (listType) output.push(`\\end{${listType}}`, '')
    listType = undefined
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = /^\s*```\s*([^\s]*)/.exec(line)
    if (fence) {
      closeList()
      const body = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) { body.push(lines[index]); index += 1 }
      output.push('\\begin{verbatim}', ...body, '\\end{verbatim}', '')
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      closeList()
      const command = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'][Math.min(heading[1].length, 6) - 1]
      output.push(`\\${command}{${inlineLatex(heading[2])}}`, '')
      continue
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (unordered || ordered) {
      const nextType = unordered ? 'itemize' : 'enumerate'
      if (listType !== nextType) { closeList(); listType = nextType; output.push(`\\begin{${listType}}`) }
      output.push(`\\item ${inlineLatex((unordered || ordered)[1])}`)
      continue
    }
    closeList()
    if (/^\s*>/.test(line)) {
      output.push(`\\begin{quote}${inlineLatex(line.replace(/^\s*>\s?/, ''))}\\end{quote}`, '')
    } else if (/^\s*\$\$.+\$\$\s*$/.test(line)) {
      output.push(line.trim(), '')
    } else if (line.trim()) {
      output.push(inlineLatex(line.trim()), '')
    }
  }
  closeList()
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function renderLatexDocument({ title, markdown, bibliographyFile = 'references' }) {
  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[UTF8]{ctex}',
    '\\usepackage[a4paper,margin=2.5cm]{geometry}',
    '\\usepackage{hyperref}',
    '\\usepackage{booktabs}',
    '\\usepackage{longtable}',
    '\\hypersetup{colorlinks=true,linkcolor=blue,urlcolor=blue,citecolor=blue}',
    `\\title{${latexEscape(title)}}`,
    '\\author{小何的科研助手导出}',
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    markdownToLatex(markdown),
    '',
    '\\bibliographystyle{IEEEtran}',
    `\\bibliography{${bibliographyFile}}`,
    '\\end{document}',
    '',
  ].join('\n')
}

function tectonicCandidates(explicitPath) {
  return [...new Set([explicitPath, process.env.RESEARCH_READER_TECTONIC, process.env.TECTONIC_PATH, 'tectonic.exe', 'tectonic'].filter(Boolean))]
}

function findTectonic(explicitPath, spawn = spawnSync) {
  for (const candidate of tectonicCandidates(explicitPath)) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue
    const result = spawn(candidate, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    if (!result.error && result.status === 0) return candidate
  }
  return undefined
}

function compileLatexPackage({ directory, entryFile = 'main.tex', tectonicPath, spawn = spawnSync }) {
  const executable = findTectonic(tectonicPath, spawn)
  if (!executable) return { compiled: false, reason: '未找到 Tectonic；已保留可编辑的 main.tex、references.bib 和 source.md。' }
  const result = spawn(executable, ['--keep-logs', '--keep-intermediates', entryFile], {
    cwd: directory,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const pdfPath = path.join(directory, entryFile.replace(/\.tex$/i, '.pdf'))
  if (result.error || result.status !== 0 || !fs.existsSync(pdfPath)) {
    return { compiled: false, reason: String(result.stderr || result.stdout || result.error?.message || 'Tectonic 编译失败。').slice(0, 4000), executable }
  }
  return { compiled: true, pdfPath, executable }
}

module.exports = { compileLatexPackage, findTectonic, latexEscape, markdownToLatex, renderLatexDocument }

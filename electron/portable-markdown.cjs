const crypto = require('node:crypto')

const PORTABLE_EXPORT_KINDS = new Set(['reading_card', 'review_document', 'experiment_retrospective', 'research_report'])

function portableMarkdownFileName(kind, title, id) {
  if (!PORTABLE_EXPORT_KINDS.has(kind)) throw new Error('不支持的可迁移 Markdown 类型。')
  const prefix = {
    reading_card: 'reading-card',
    review_document: 'review',
    experiment_retrospective: 'run',
    research_report: 'report',
  }[kind]
  const slug = String(title || 'untitled').normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f#[\]]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'untitled'
  const stableId = crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12)
  return `${prefix}--${slug}--${stableId}.md`
}

function renderPortableMarkdown({ kind, id, title, status, createdAt, updatedAt, project, body, links = [], references = [] }) {
  if (!PORTABLE_EXPORT_KINDS.has(kind)) throw new Error('不支持的可迁移 Markdown 类型。')
  const values = {
    title, type: kind, id, status, project_id: project?.id, project: project?.name,
    created: createdAt, updated: updatedAt, source_of_truth: '小何的科研助手本地记录',
    export_direction: 'one-way-snapshot', portable_schema: 1,
  }
  const frontmatter = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
  const related = links.length ? ['## 研究库链接', '', ...links.map(link => `- [[${link.fileName.replace(/\.md$/i, '')}|${link.label}]]`), ''] : []
  const refs = references.length ? ['## 可追溯来源', '', ...references.map(referenceLine), ''] : []
  return `---\n${frontmatter.join('\n')}\n---\n\n# ${title}\n\n> 这是从本地正式记录生成的单向 Markdown 快照；请回到小何的科研助手修改正式记录，再重新导出。\n\n${String(body || '').trim()}\n\n${related.join('\n')}${refs.join('\n')}`.trimEnd() + '\n'
}

function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(String(value))
}

function referenceLine(reference) {
  const parts = [`- ${reference.label || reference.type || '来源'}`]
  if (reference.paperTitle) parts.push(`论文：${reference.paperTitle}`)
  if (reference.pageNumber) parts.push(`第 ${reference.pageNumber} 页`)
  if (reference.runTitle) parts.push(`Run：${reference.runTitle}`)
  if (reference.originalFile) parts.push(`原始文件：\`${String(reference.originalFile).replace(/`/g, '\\`')}\``)
  if (reference.deepLink) parts.push(`[回到证据](${reference.deepLink})`)
  if (reference.id) parts.push(`ID：\`${reference.id}\``)
  return parts.join(' · ')
}

module.exports = { PORTABLE_EXPORT_KINDS, portableMarkdownFileName, renderPortableMarkdown }

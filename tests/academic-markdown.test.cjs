const assert = require('node:assert/strict')
const test = require('node:test')

test('规则排版只修复论文标题层级和空行，不改写正文句子', async () => {
  const { normalizeAcademicMarkdown } = await import('../src/academic-markdown-skill.mjs')
  const source = 'Abstract\nThis paper proposes a controller.\n\n2 Methods\nForce feedback is preserved.\n\nReferences\n[1] Example.'
  const result = normalizeAcademicMarkdown(source)
  assert.match(result, /^## Abstract/m)
  assert.match(result, /^## 2 Methods/m)
  assert.match(result, /^## References/m)
  assert.match(result, /This paper proposes a controller\./)
  assert.match(result, /Force feedback is preserved\./)
  assert.match(result, /\[1\] Example\./)
})

test('AI 只能返回原顺序章节边界，不能替换正文或编造块', async () => {
  const {
    buildAcademicMarkdown,
    parseAcademicMarkdownBoundaries,
    splitAcademicMarkdownBlocks,
  } = await import('../src/academic-markdown-skill.mjs')
  const source = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
  const { blocks } = splitAcademicMarkdownBlocks(source)
  const boundaries = parseAcademicMarkdownBoundaries(JSON.stringify({
    boundaries: [
      { beforeBlockId: blocks[0].id, section: '摘要' },
      { beforeBlockId: blocks[1].id, section: '方法' },
    ],
  }), source)
  const result = buildAcademicMarkdown(source, boundaries)
  assert.match(result, /^## 摘要\n\nFirst paragraph\./)
  assert.match(result, /## 方法\n\nSecond paragraph\./)
  assert.match(result, /Third paragraph\.$/)
  assert.throws(
    () => parseAcademicMarkdownBoundaries(JSON.stringify({
      boundaries: [{ beforeBlockId: 'block-9999', section: '结果' }],
    }), source),
    /未知、重复、乱序或不允许/,
  )
})

test('Markdown 变化后旧的 AI 章节布局自动失效', async () => {
  const {
    ACADEMIC_MARKDOWN_SKILL,
    academicMarkdownFingerprint,
    validAcademicMarkdownLayout,
  } = await import('../src/academic-markdown-skill.mjs')
  const source = 'Original paragraph.'
  const layout = {
    version: ACADEMIC_MARKDOWN_SKILL.version,
    sourceFingerprint: academicMarkdownFingerprint(source),
    boundaries: [],
  }
  assert.equal(validAcademicMarkdownLayout(layout, source), true)
  assert.equal(validAcademicMarkdownLayout(layout, `${source}\nChanged.`), false)
})

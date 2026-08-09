const assert = require('node:assert/strict')
const test = require('node:test')
const { CitationFormatter, formatGB7714 } = require('../electron/citation-formatter.cjs')
const { writeClipboardText } = require('../electron/clipboard-service.cjs')

test('中文期刊固定输出卷期页与 DOI，默认不伪造序号', () => {
  const result = formatGB7714({
    itemType: 'article-journal',
    title: '科研阅读中的证据管理',
    authors: [{ literal: '何小明' }, { literal: '李华' }],
    issued: '2025-03-01',
    containerTitle: '情报学报',
    volume: '44',
    issue: '3',
    pages: '12-20',
    language: 'zh-CN',
    identifiers: { DOI: ['https://doi.org/10.1234/example.5'] },
  })
  assert.equal(result.text, '何小明, 李华. 科研阅读中的证据管理[J]. 情报学报, 2025, 44(3): 12-20. DOI:10.1234/example.5.')
  assert.equal(result.incomplete, false)
  assert.equal(result.text.includes('[1]'), false)
})

test('英文期刊作者姓大写，四位以上保留三位并使用 et al', () => {
  const result = formatGB7714({
    itemType: 'JOUR',
    title: 'Traceable research workspaces',
    authors: [
      { family: 'Smith', given: 'John A.' },
      { family: 'van Rossum', given: 'Guido' },
      { family: "O'Neil", given: 'Mary-Jane' },
      { family: 'Wang', given: 'Li' },
    ],
    issued: '2024',
    containerTitle: 'Journal of Open Research',
    volume: '8',
    issue: '2',
    pages: '101-119',
    language: 'en',
    identifiers: {},
  })
  assert.equal(result.text, "SMITH J A, VAN ROSSUM G, O'NEIL M J, et al. Traceable research workspaces[J]. Journal of Open Research, 2024, 8(2): 101-119.")
})

test('中文多作者使用等，传入真实顺序时才添加编号', () => {
  const result = formatGB7714({
    itemType: 'book',
    title: '科研方法',
    authors: [{ literal: '张三' }, { literal: '李四' }, { literal: '王五' }, { literal: '赵六' }],
    issued: '2023',
    publisherPlace: '北京',
    publisher: '科学出版社',
    language: 'zh',
    identifiers: {},
  }, { sequence: 7 })
  assert.equal(result.text, '[7]张三, 李四, 王五, 等. 科研方法[M]. 北京: 科学出版社, 2023.')
})

test('会议论文、学位论文与报告使用统一出版项规则', () => {
  assert.equal(formatGB7714({
    itemType: 'paper-conference', title: 'A robust parser', authors: [{ family: 'Doe', given: 'Jane' }],
    containerTitle: 'Proceedings of TestConf', publisherPlace: 'London', publisher: 'ACM', issued: '2022', pages: '9-15', language: 'en', identifiers: {},
  }).text, 'DOE J. A robust parser[C]//Proceedings of TestConf. London: ACM, 2022: 9-15.')
  assert.equal(formatGB7714({
    itemType: 'thesis', title: '结构化科研阅读研究', authors: [{ literal: '陈晓' }],
    publisherPlace: '上海', publisher: '复旦大学', issued: '2021', language: 'zh', identifiers: {},
  }).text, '陈晓. 结构化科研阅读研究[D]. 上海: 复旦大学, 2021.')
  assert.equal(formatGB7714({
    itemType: 'report', title: '开放科研年度报告', authors: [{ literal: '中国科研数据中心' }],
    publisherPlace: '北京', publisher: '中国科研数据中心', issued: '2020', language: 'zh', identifiers: {},
  }).text, '中国科研数据中心. 开放科研年度报告[R]. 北京: 中国科研数据中心, 2020.')
})

test('网页保留发布日期、引用日期、URL 与特殊字符', () => {
  const result = formatGB7714({
    itemType: 'webpage',
    title: 'R&D <evidence> & reproducibility',
    authors: [{ literal: 'Open Research Team' }],
    issued: '2026-01-02',
    accessed: '2026/08/08',
    language: 'en',
    identifiers: { URL: ['https://example.org/a?x=1&y=<two>'] },
  })
  assert.equal(result.text, 'TEAM O R. R&D <evidence> & reproducibility[EB/OL]. (2026-01-02)[2026-08-08]. https://example.org/a?x=1&y=<two>.')
})

test('缺失元数据时仍降级输出并返回明确缺项，不编造字段', () => {
  const result = formatGB7714({ itemType: 'journalArticle', title: '只有题名', authors: [], identifiers: {} })
  assert.equal(result.text, '佚名. 只有题名[J].')
  assert.deepEqual(result.missingFields.map(field => field.label), ['作者', '期刊名', '出版年'])
  assert.equal(result.incomplete, true)
})

test('导入层的无题名占位符仍被识别为缺失字段', () => {
  const result = formatGB7714({ itemType: 'book', title: '[无题名记录]', authors: [], identifiers: {} })
  assert.ok(result.missingFields.some(field => field.field === 'title'))
})

test('统一 CitationFormatter 拒绝未实现的样式', () => {
  const formatter = new CitationFormatter()
  assert.equal(formatter.format({ itemType: 'book', title: '测试', authors: [] }, { style: 'gb-t-7714-2015' }).standard, 'GB/T 7714—2015')
  assert.throws(() => formatter.format({}, { style: 'apa' }), /不支持的引用格式/)
})

test('剪贴板服务写入后回读确认，失败时不假装成功', () => {
  let stored = ''
  const clipboard = { writeText: value => { stored = value }, readText: () => stored }
  assert.deepEqual(writeClipboardText(clipboard, { text: '张三. 论文[J].' }), { written: true, characterCount: 10 })
  assert.equal(stored, '张三. 论文[J].')
  assert.throws(
    () => writeClipboardText({ writeText() {}, readText: () => '被其他程序覆盖' }, { text: '原引用' }),
    /未确认写入/,
  )
})

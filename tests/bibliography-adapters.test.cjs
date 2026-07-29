const assert = require('node:assert/strict')
const test = require('node:test')
const {
  detectBibliographyFormat,
  parseBibliography,
  parseBibtex,
  parseEndnoteXml,
  parseRis,
  splitBibtexRecords,
} = require('../electron/bibliography-adapters.cjs')

test('题录格式检测同时参考扩展名和真实内容', () => {
  assert.equal(detectBibliographyFormat({ fileName: 'library.ris', text: '' }), 'ris')
  assert.equal(detectBibliographyFormat({ fileName: 'unknown.txt', text: 'TY  - JOUR\nER  - ' }), 'ris')
  assert.equal(detectBibliographyFormat({ fileName: 'refs.bib', text: '@article{x}' }), 'bibtex')
  assert.equal(detectBibliographyFormat({ fileName: 'endnote.xml', text: '<xml><records><record/></records></xml>' }), 'endnote-xml')
  assert.equal(detectBibliographyFormat({ fileName: 'notes.txt', text: 'plain text' }), undefined)
})

test('RIS 复用 Citation.js 解析语义，同时保留重复字段、原始编号、续行和附件路径', () => {
  const text = [
    'TY  - JOUR',
    'ID  - EN-42',
    'AU  - Doe, Jane',
    'AU  - Roe, John',
    'TI  - Traceable Reading',
    'PY  - 2025',
    'AB  - First line',
    '      continuation line',
    'DO  - 10.1234/example',
    'L1  - C:\\Papers\\traceable.pdf',
    'ZZ  - unknown stays',
    'ER  - ',
    '',
  ].join('\r\n')
  const [record] = parseRis({ text })
  assert.equal(record.rawRecordId, 'EN-42')
  assert.equal(record.rawRecordIdField, 'ID')
  assert.equal(record.normalized.title, 'Traceable Reading')
  assert.equal(record.normalized.authors.length, 2)
  assert.deepEqual(record.normalized.identifiers.DOI, ['10.1234/example'])
  assert.deepEqual(record.rawFields.ZZ, ['unknown stays'])
  assert.match(record.rawFields.AB[0], /continuation line/)
  assert.equal(record.attachments[0].pathOriginal, 'C:\\Papers\\traceable.pdf')
  assert.equal(record.rawPayload, text)
})

test('BibTeX 支持嵌套花括号并保留 citation key、未知字段与原附件值', () => {
  const text = [
    '@article{smith2024,',
    '  title = {A {Nested} Title},',
    '  author = {Smith, Alice and Doe, Bob},',
    '  year = {2024},',
    '  doi = {10.5678/nested},',
    '  file = {paper:C:/Library/paper.pdf:application/pdf},',
    '  custom-field = {keep me}',
    '}',
    '',
    '@book{book-key, title={Second Entry}, year={2020}}',
  ].join('\n')
  assert.equal(splitBibtexRecords(text).length, 2)
  const records = parseBibtex({ text })
  assert.equal(records.length, 2)
  assert.equal(records[0].rawRecordId, 'smith2024')
  assert.equal(records[0].rawRecordIdField, 'citation-key')
  assert.match(records[0].normalized.title, /Nested/)
  assert.deepEqual(records[0].normalized.identifiers.DOI, ['10.5678/nested'])
  assert.deepEqual(records[0].rawFields['custom-field'], ['keep me'])
  assert.equal(records[0].attachments[0].pathOriginal, 'paper:C:/Library/paper.pdf:application/pdf')
  assert.match(records[0].rawPayload, /^@article/)
})

test('EndNote XML 保留 rec-number、格式化文本、未知字段和 internal-pdf 原路径', () => {
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<xml><records><record>
  <rec-number>13264</rec-number>
  <ref-type name="Journal Article">17</ref-type>
  <contributors><authors>
    <author><style face="normal">Chapman, A. G.</style></author>
    <author>Doe, Jane</author>
  </authors></contributors>
  <titles><title><style face="normal">Traceable </style><style face="italic">Evidence</style></title></titles>
  <periodical><full-title>Research Systems</full-title></periodical>
  <dates><year>2025</year></dates>
  <volume>4</volume><number>2</number><pages>10-20</pages>
  <keywords><keyword>reading</keyword><keyword>evidence</keyword></keywords>
  <electronic-resource-num>10.9999/endnote</electronic-resource-num>
  <urls><pdf-urls><url>internal-pdf://Paper Folder/paper.pdf</url></pdf-urls></urls>
  <custom9>must survive</custom9>
</record></records></xml>`
  const [record] = parseEndnoteXml({ text })
  assert.equal(record.rawRecordId, '13264')
  assert.equal(record.rawRecordIdField, 'rec-number')
  assert.equal(record.normalized.itemType, 'Journal Article')
  assert.equal(record.normalized.title, 'Traceable Evidence')
  assert.equal(record.normalized.authors.length, 2)
  assert.deepEqual(record.normalized.identifiers.DOI, ['10.9999/endnote'])
  assert.deepEqual(record.rawFields.custom9, ['must survive'])
  assert.equal(record.attachments[0].pathOriginal, 'internal-pdf://Paper Folder/paper.pdf')
  assert.match(record.rawPayload, /^<record>/)
})

test('不完整条目会明确失败，不静默制造记录', () => {
  assert.throws(() => parseRis({ text: 'TY  - JOUR\nTI  - no end' }), /完整记录/)
  assert.throws(() => parseBibtex({ text: '@article{broken,title={x}' }), /未闭合/)
  assert.throws(() => parseEndnoteXml({ text: '<xml><records>' }), /语法错误/)
  assert.throws(() => parseBibliography({ fileName: 'plain.txt', text: 'hello' }), /无法识别/)
})

test('所选解析依赖均为宽松 MIT 许可证', () => {
  const lock = require('../package-lock.json')
  assert.equal(lock.packages['node_modules/@citation-js/core'].license, 'MIT')
  assert.equal(lock.packages['node_modules/@citation-js/plugin-ris'].license, 'MIT')
  assert.equal(lock.packages['node_modules/@citation-js/plugin-bibtex'].license, 'MIT')
  assert.equal(lock.packages['node_modules/fast-xml-parser'].license, 'MIT')
})

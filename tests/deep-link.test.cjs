const assert = require('node:assert/strict')
const test = require('node:test')
const { findResearchReaderLink, parseResearchReaderLink } = require('../electron/deep-link.cjs')

test('复查引用深链只接受研究阅读协议、合法来源编号和正页码', () => {
  assert.deepEqual(
    parseResearchReaderLink('research-reader://open?sourceId=source-1&page=7&fragmentId=quote%3A1'),
    { sourceId: 'source-1', pageNumber: 7, fragmentId: 'quote:1' },
  )
  assert.deepEqual(
    findResearchReaderLink(['app.exe', '--flag', 'research-reader://open?sourceId=source_2&page=3']),
    { sourceId: 'source_2', pageNumber: 3, fragmentId: undefined },
  )
  assert.equal(parseResearchReaderLink('https://example.com/?sourceId=source-1'), undefined)
  assert.equal(parseResearchReaderLink('research-reader://open?sourceId=..%2Fsecret&page=1'), undefined)
  assert.equal(parseResearchReaderLink('research-reader://open?sourceId=source-1&fragmentId=..%2Fsecret'), undefined)
  assert.equal(parseResearchReaderLink('research-reader://open?sourceId=source-1&page=-1').pageNumber, undefined)
})

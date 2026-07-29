const { Cite, plugins } = require('@citation-js/core')
require('@citation-js/plugin-bibtex')
require('@citation-js/plugin-ris')
const { XMLParser, XMLValidator } = require('fast-xml-parser')

const PARSER_VERSION = '1'

function detectBibliographyFormat({ fileName = '', text = '' }) {
  const extension = String(fileName).toLowerCase().match(/\.([^.]+)$/)?.[1]
  const sample = String(text).slice(0, 32_768)
  if (extension === 'ris' || /^\s*TY {2}-/m.test(sample)) return 'ris'
  if (extension === 'bib' || /^\s*@[a-zA-Z]+\s*[{(]/m.test(sample)) return 'bibtex'
  if (
    (extension === 'xml' && /<records(?:\s|>)/i.test(sample) && /<record(?:\s|>)/i.test(sample))
    || /<xml(?:\s|>)[\s\S]*?<records(?:\s|>)/i.test(sample)
  ) return 'endnote-xml'
  return undefined
}

function parseBibliography(input) {
  const format = input.format || detectBibliographyFormat(input)
  if (format === 'ris') return parseRis(input)
  if (format === 'bibtex') return parseBibtex(input)
  if (format === 'endnote-xml') return parseEndnoteXml(input)
  throw new Error('无法识别题录格式；第一阶段只支持 EndNote XML、RIS 和 BibTeX。')
}

function parseRis({ text = '' }) {
  const rawRecords = splitRisRecords(String(text))
  if (!rawRecords.length) throw new Error('RIS 中没有找到以 TY 开始、ER 结束的完整记录。')
  return rawRecords.map((rawPayload, index) => {
    const rawEntry = plugins.input.chainLink(rawPayload, '@ris/record')?.[0] || {}
    const csl = stripGraph(new Cite(rawPayload).data?.[0] || {})
    const rawFields = valuesAsArrays(rawEntry)
    const recordIdField = firstPresentField(rawFields, ['ID', 'AN'])
    return makeRecord({
      ordinal: index + 1,
      format: 'ris',
      csl,
      rawPayload,
      rawFields,
      rawRecordId: recordIdField ? rawFields[recordIdField][0] : undefined,
      rawRecordIdField: recordIdField,
      attachments: arrayValues(rawFields.L1).map(pathOriginal => ({ pathOriginal, role: 'primary' })),
      fallbacks: {
        itemType: firstValue(rawFields.TY),
        title: firstValue(rawFields.TI) || firstValue(rawFields.T1),
        authors: arrayValues(rawFields.AU || rawFields.A1).map(parsePersonLiteral),
        issued: firstValue(rawFields.PY) || firstValue(rawFields.Y1),
        containerTitle: firstValue(rawFields.T2) || firstValue(rawFields.JO) || firstValue(rawFields.JF),
        volume: firstValue(rawFields.VL),
        issue: firstValue(rawFields.IS),
        pages: joinPages(firstValue(rawFields.SP), firstValue(rawFields.EP)),
        abstract: firstValue(rawFields.AB) || firstValue(rawFields.N2),
        language: firstValue(rawFields.LA),
        keywords: arrayValues(rawFields.KW),
        identifiers: compactIdentifiers({
          DOI: arrayValues(rawFields.DO),
          ISSN: arrayValues(rawFields.SN),
          URL: arrayValues(rawFields.UR),
        }),
      },
    })
  })
}

function parseBibtex({ text = '' }) {
  const rawRecords = splitBibtexRecords(String(text))
  if (!rawRecords.length) throw new Error('BibTeX 中没有找到完整条目。')
  return rawRecords.map((rawPayload, index) => {
    const parsedEntry = plugins.input.chainLink(rawPayload, '@bibtex/entries+list')?.[0]
    if (!parsedEntry) throw new Error(`BibTeX 第 ${index + 1} 条记录无法解析。`)
    const csl = stripGraph(new Cite(rawPayload).data?.[0] || {})
    const rawFields = valuesAsArrays(parsedEntry.properties || {})
    return makeRecord({
      ordinal: index + 1,
      format: 'bibtex',
      csl,
      rawPayload,
      rawFields,
      rawRecordId: parsedEntry.label,
      rawRecordIdField: 'citation-key',
      attachments: arrayValues(rawFields.file).map(pathOriginal => ({ pathOriginal, role: 'primary' })),
      fallbacks: {
        itemType: parsedEntry.type,
        title: firstValue(rawFields.title),
        authors: splitBibtexAuthors(firstValue(rawFields.author)),
        issued: firstValue(rawFields.year),
        containerTitle: firstValue(rawFields.journal) || firstValue(rawFields.booktitle),
        volume: firstValue(rawFields.volume),
        issue: firstValue(rawFields.number),
        pages: firstValue(rawFields.pages),
        abstract: firstValue(rawFields.abstract),
        language: firstValue(rawFields.language) || firstValue(rawFields.langid),
        keywords: splitKeywords(firstValue(rawFields.keywords)),
        identifiers: compactIdentifiers({
          DOI: arrayValues(rawFields.doi),
          ISBN: arrayValues(rawFields.isbn),
          ISSN: arrayValues(rawFields.issn),
          URL: arrayValues(rawFields.url),
        }),
      },
    })
  })
}

function parseEndnoteXml({ text = '' }) {
  const xml = String(text)
  const validation = XMLValidator.validate(xml)
  if (validation !== true) throw new Error(`EndNote XML 语法错误：${validation.err.msg}`)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: false,
    parseTagValue: false,
    isArray: (_name, path) => /(?:records\.record|authors\.author|keywords\.keyword|urls\.[^.]+-urls\.url)$/.test(path),
  })
  const document = parser.parse(xml)
  const records = asArray(document?.xml?.records?.record)
  if (!records.length) throw new Error('EndNote XML 中没有找到 xml/records/record。')
  const exactRecords = xml.match(/<record(?:\s[^>]*)?>[\s\S]*?<\/record\s*>/gi) || []
  return records.map((record, index) => {
    const rawPayload = exactRecords.length === records.length ? exactRecords[index] : xml
    const rawFields = flattenEndnoteFields(record)
    const authors = asArray(record?.contributors?.authors?.author).map(author => parsePersonLiteral(textValue(author))).filter(hasPerson)
    const keywords = asArray(record?.keywords?.keyword).map(textValue).filter(Boolean)
    const electronicResourceNumber = textValue(record?.['electronic-resource-num'])
    const isbn = textValue(record?.isbn)
    const attachments = ['pdf-urls', 'text-urls', 'image-urls']
      .flatMap(group => asArray(record?.urls?.[group]?.url))
      .map(textValue)
      .filter(Boolean)
      .map(pathOriginal => ({ pathOriginal, role: groupRole(pathOriginal) }))
    const refType = attributeValue(record?.['ref-type'], 'name') || textValue(record?.['ref-type']) || 'unknown'
    return {
      ordinal: index + 1,
      normalized: {
        itemType: refType,
        title: textValue(record?.titles?.title),
        authors,
        issued: textValue(record?.dates?.year) || undefined,
        containerTitle: textValue(record?.periodical?.['full-title']) || textValue(record?.titles?.['secondary-title']) || undefined,
        volume: textValue(record?.volume) || undefined,
        issue: textValue(record?.number) || undefined,
        pages: textValue(record?.pages) || undefined,
        abstract: textValue(record?.abstract) || undefined,
        language: textValue(record?.language) || undefined,
        keywords,
        identifiers: compactIdentifiers({
          DOI: /^10\.\d{4,9}\//.test(electronicResourceNumber) ? [electronicResourceNumber] : [],
          'electronic-resource-num': electronicResourceNumber ? [electronicResourceNumber] : [],
          ISBN: isbn ? [isbn] : [],
        }),
      },
      rawRecordId: textValue(record?.['rec-number']) || undefined,
      rawRecordIdField: textValue(record?.['rec-number']) ? 'rec-number' : undefined,
      rawPayload,
      rawFields,
      attachments,
      warnings: exactRecords.length === records.length ? [] : [{
        code: 'raw-record-fallback',
        message: '无法安全切分单条 XML，rawPayload 已保存完整导入文件。',
      }],
      parserName: 'fast-xml-parser+endnote-adapter',
      parserVersion: `5.10.1/${PARSER_VERSION}`,
    }
  })
}

function makeRecord({ ordinal, csl, rawPayload, rawFields, rawRecordId, rawRecordIdField, attachments, fallbacks }) {
  const identifiers = compactIdentifiers({
    DOI: csl.DOI ? [csl.DOI] : [],
    ISBN: arrayValues(csl.ISBN),
    ISSN: arrayValues(csl.ISSN),
    PMID: csl.PMID ? [csl.PMID] : [],
    PMCID: csl.PMCID ? [csl.PMCID] : [],
    URL: csl.URL ? [csl.URL] : [],
    ...fallbacks.identifiers,
  })
  return {
    ordinal,
    normalized: {
      itemType: csl.type || fallbacks.itemType || 'unknown',
      title: csl.title || fallbacks.title || '',
      authors: Array.isArray(csl.author) && csl.author.length ? csl.author.map(normalizeCslPerson) : fallbacks.authors,
      issued: issuedString(csl.issued) || fallbacks.issued || undefined,
      containerTitle: csl['container-title'] || fallbacks.containerTitle || undefined,
      volume: csl.volume || fallbacks.volume || undefined,
      issue: csl.issue || fallbacks.issue || undefined,
      pages: csl.page || fallbacks.pages || undefined,
      abstract: csl.abstract || fallbacks.abstract || undefined,
      language: csl.language || fallbacks.language || undefined,
      keywords: arrayValues(csl.keyword).length ? arrayValues(csl.keyword) : fallbacks.keywords,
      identifiers,
    },
    rawRecordId,
    rawRecordIdField,
    rawPayload,
    rawFields,
    attachments,
    warnings: csl.title || fallbacks.title ? [] : [{ code: 'missing-title', message: '记录没有题名，需要人工核对。' }],
    parserName: 'citation-js',
    parserVersion: `0.8.2/${PARSER_VERSION}`,
  }
}

function splitRisRecords(text) {
  const records = []
  let current = []
  for (const line of text.split(/(?<=\n)/)) {
    const plain = line.replace(/\r?\n$/, '')
    if (/^TY {2}-/.test(plain)) {
      if (current.length) current = []
      current.push(line)
      continue
    }
    if (!current.length) continue
    current.push(line)
    if (/^ER {2}-(?:\s|$)/.test(plain)) {
      records.push(current.join(''))
      current = []
    }
  }
  return records
}

function splitBibtexRecords(text) {
  const records = []
  let index = 0
  while (index < text.length) {
    const start = text.indexOf('@', index)
    if (start < 0) break
    const open = text.slice(start).search(/[({]/)
    if (open < 0) break
    const openIndex = start + open
    const openChar = text[openIndex]
    const closeChar = openChar === '{' ? '}' : ')'
    let depth = 1
    let quote = false
    let escaped = false
    let cursor = openIndex + 1
    for (; cursor < text.length; cursor += 1) {
      const char = text[cursor]
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === '"' && depth === 1) { quote = !quote; continue }
      if (quote) continue
      if (char === openChar) depth += 1
      if (char === closeChar) depth -= 1
      if (depth === 0) {
        records.push(text.slice(start, cursor + 1))
        index = cursor + 1
        break
      }
    }
    if (depth !== 0) throw new Error(`BibTeX 在字符 ${start + 1} 附近存在未闭合条目。`)
  }
  return records
}

function flattenEndnoteFields(record) {
  const result = {}
  for (const [key, value] of Object.entries(record || {})) {
    const values = collectLeafText(value)
    if (values.length) result[key] = values
  }
  return result
}

function collectLeafText(value) {
  if (value == null) return []
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(collectLeafText)
  return Object.entries(value)
    .filter(([key]) => !key.startsWith('@_'))
    .flatMap(([, child]) => collectLeafText(child))
    .filter(Boolean)
}

function textValue(value) {
  return collectLeafText(value).join('').trim()
}

function attributeValue(value, name) {
  return value && typeof value === 'object' ? String(value[`@_${name}`] || '').trim() : ''
}

function valuesAsArrays(input) {
  return Object.fromEntries(Object.entries(input || {}).map(([key, value]) => [key, arrayValues(value).map(String)]))
}

function arrayValues(value) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value.flatMap(arrayValues) : [String(value)]
}

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function firstValue(value) {
  return arrayValues(value)[0]
}

function firstPresentField(fields, candidates) {
  return candidates.find(field => fields[field]?.length)
}

function joinPages(start, end) {
  if (start && end) return `${start}-${end}`
  return start || end
}

function splitKeywords(value) {
  return value ? value.split(/[;,]/).map(item => item.trim()).filter(Boolean) : []
}

function splitBibtexAuthors(value) {
  return value ? value.split(/\s+and\s+/i).map(parsePersonLiteral).filter(hasPerson) : []
}

function parsePersonLiteral(value) {
  const literal = String(value || '').trim()
  if (!literal) return {}
  const [family, ...given] = literal.split(',').map(part => part.trim())
  return given.length ? { family, given: given.join(', ') } : { literal }
}

function normalizeCslPerson(person) {
  return {
    ...(person.family ? { family: person.family } : {}),
    ...(person.given ? { given: person.given } : {}),
    ...(person.literal ? { literal: person.literal } : {}),
  }
}

function hasPerson(person) {
  return Boolean(person.family || person.given || person.literal)
}

function issuedString(issued) {
  const parts = issued?.['date-parts']?.[0]
  return Array.isArray(parts) && parts.length ? parts.join('-') : undefined
}

function compactIdentifiers(identifiers) {
  return Object.fromEntries(Object.entries(identifiers)
    .map(([key, values]) => [key, [...new Set(arrayValues(values).map(value => value.trim()).filter(Boolean))]])
    .filter(([, values]) => values.length))
}

function stripGraph(csl) {
  const { _graph, ...clean } = csl
  return clean
}

function groupRole(pathOriginal) {
  return /\.pdf(?:$|[?#])/i.test(pathOriginal) || /^internal-pdf:/i.test(pathOriginal) ? 'primary' : 'other'
}

module.exports = {
  detectBibliographyFormat,
  parseBibliography,
  parseBibtex,
  parseEndnoteXml,
  parseRis,
  splitBibtexRecords,
  splitRisRecords,
}

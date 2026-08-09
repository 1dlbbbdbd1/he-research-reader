const crypto = require('node:crypto')

const STANDARD = 'GB/T 7714—2015'
const CITATION_STYLES = Object.freeze([
  { id: 'gb-t-7714-2015', label: STANDARD },
  { id: 'apa-7', label: 'APA 7th' },
  { id: 'ieee', label: 'IEEE' },
  { id: 'bibtex', label: 'BibTeX' },
])

const TYPE_ALIASES = new Map([
  ['article-journal', 'journal'], ['article-magazine', 'journal'], ['journalarticle', 'journal'], ['journal article', 'journal'], ['jour', 'journal'],
  ['book', 'book'], ['monograph', 'book'],
  ['paper-conference', 'conference'], ['conferencepaper', 'conference'], ['conference paper', 'conference'], ['conf', 'conference'],
  ['thesis', 'thesis'], ['dissertation', 'thesis'], ['doctoral thesis', 'thesis'], ['masters thesis', 'thesis'],
  ['report', 'report'], ['rprt', 'report'],
  ['webpage', 'web'], ['post-weblog', 'web'], ['web page', 'web'], ['electronic article', 'web'], ['online multimedia', 'web'],
])

const TYPE_CODES = {
  journal: 'J',
  book: 'M',
  conference: 'C',
  thesis: 'D',
  report: 'R',
  web: 'EB/OL',
  unknown: 'Z',
}

const REQUIRED_FIELDS = {
  journal: [['authors', '作者'], ['title', '题名'], ['containerTitle', '期刊名'], ['issued', '出版年']],
  book: [['authors', '作者'], ['title', '题名'], ['publisherPlace', '出版地'], ['publisher', '出版社'], ['issued', '出版年']],
  conference: [['authors', '作者'], ['title', '题名'], ['containerTitle', '会议或论文集名称'], ['publisherPlace', '出版地'], ['publisher', '出版者'], ['issued', '出版年']],
  thesis: [['authors', '作者'], ['title', '题名'], ['publisherPlace', '保存地'], ['publisher', '授予单位'], ['issued', '年份']],
  report: [['authors', '作者'], ['title', '题名'], ['publisherPlace', '出版地'], ['publisher', '发布机构'], ['issued', '年份']],
  web: [['authors', '责任者'], ['title', '题名'], ['issued', '发布日期'], ['accessed', '引用日期'], ['url', 'URL']],
  unknown: [['authors', '作者'], ['title', '题名'], ['issued', '年份']],
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeType(itemType) {
  return TYPE_ALIASES.get(clean(itemType).toLowerCase()) || 'unknown'
}

function containsHan(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ''))
}

function isChineseRecord(item) {
  const language = clean(item.language).toLowerCase()
  if (/^(zh|chi|zho)(?:[-_]|$)/.test(language) || language === '中文' || language === 'chinese') return true
  return containsHan(item.title) || (Array.isArray(item.authors) && item.authors.some(author => containsHan(author?.literal) || containsHan(author?.family) || containsHan(author?.given)))
}

function englishInitials(given) {
  return clean(given)
    .split(/[\s-]+/)
    .map(part => part.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase())
    .filter(Boolean)
    .join(' ')
}

function parseEnglishLiteral(literal) {
  const value = clean(literal)
  if (!value) return { family: '', given: '' }
  if (value.includes(',')) {
    const [family, ...given] = value.split(',')
    return { family: clean(family), given: clean(given.join(' ')) }
  }
  const parts = value.split(' ')
  if (parts.length === 1) return { family: parts[0], given: '' }
  return { family: parts.at(-1), given: parts.slice(0, -1).join(' ') }
}

function formatPerson(person, chinese) {
  const literal = clean(person?.literal)
  const family = clean(person?.family)
  const given = clean(person?.given)
  if (chinese) return literal || `${family}${given}` || family || given
  const parsed = family || given ? { family, given } : parseEnglishLiteral(literal)
  const surname = clean(parsed.family).toUpperCase()
  const initials = englishInitials(parsed.given)
  return [surname, initials].filter(Boolean).join(' ')
}

function formatAuthors(item) {
  const chinese = isChineseRecord(item)
  const authors = (Array.isArray(item.authors) ? item.authors : [])
    .map(person => formatPerson(person, chinese))
    .filter(Boolean)
  if (!authors.length) return '佚名'
  if (authors.length <= 3) return authors.join(', ')
  return `${authors.slice(0, 3).join(', ')}, ${chinese ? '等' : 'et al'}`
}

function people(item) {
  return (Array.isArray(item.authors) ? item.authors : []).map(person => {
    const literal = clean(person?.literal)
    const parsed = clean(person?.family) || clean(person?.given)
      ? { family: clean(person.family), given: clean(person.given) }
      : parseEnglishLiteral(literal)
    return { family: parsed.family || literal, given: parsed.given }
  }).filter(person => person.family || person.given)
}

function initialsWithPeriods(given) {
  return clean(given).split(/[\s-]+/).map(part => part.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase()).filter(Boolean).map(value => `${value}.`).join(' ')
}

function formatApaAuthors(item) {
  const authors = people(item).map(person => `${person.family}, ${initialsWithPeriods(person.given)}`.trim().replace(/,$/, ''))
  if (!authors.length) return 'Anonymous'
  if (authors.length === 1) return authors[0]
  if (authors.length <= 20) return `${authors.slice(0, -1).join(', ')}, & ${authors.at(-1)}`
  return `${authors.slice(0, 19).join(', ')}, … ${authors.at(-1)}`
}

function formatIeeeAuthors(item) {
  const authors = people(item).map(person => [initialsWithPeriods(person.given), person.family].filter(Boolean).join(' '))
  if (!authors.length) return 'Anonymous'
  if (authors.length <= 6) return authors.length === 1 ? authors[0] : `${authors.slice(0, -1).join(', ')}, and ${authors.at(-1)}`
  return `${authors[0]} et al.`
}

function firstIdentifier(identifiers, name) {
  if (!identifiers || typeof identifiers !== 'object') return ''
  const entry = Object.entries(identifiers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  const value = entry?.[1]
  return clean(Array.isArray(value) ? value[0] : value)
}

function normalizeDoi(value) {
  return clean(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')
}

function yearOf(value) {
  return clean(value).match(/^\d{4}/)?.[0] || clean(value)
}

function dateOf(value) {
  const parts = clean(value).match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/)
  if (!parts) return clean(value)
  return [parts[1], parts[2]?.padStart(2, '0'), parts[3]?.padStart(2, '0')].filter(Boolean).join('-')
}

function joinPublication(place, publisher, issued, pages) {
  const location = clean(place)
  const organization = clean(publisher)
  const year = yearOf(issued)
  let result = ''
  if (organization) result = location ? `${location}: ${organization}` : organization
  else if (location) result = location
  if (year) result = result ? `${result}, ${year}` : year
  if (clean(pages)) result = result ? `${result}: ${clean(pages)}` : clean(pages)
  return result
}

function present(item, field) {
  if (field === 'authors') return Array.isArray(item.authors) && item.authors.some(author => clean(author?.literal) || clean(author?.family) || clean(author?.given))
  if (field === 'title') return Boolean(clean(item.title)) && !/^\[(?:无题名记录|题名缺失)\]$/u.test(clean(item.title))
  if (field === 'url') return Boolean(firstIdentifier(item.identifiers, 'URL') || clean(item.url))
  return Boolean(clean(item[field]))
}

function missingMetadata(item, normalizedType) {
  return REQUIRED_FIELDS[normalizedType]
    .filter(([field]) => !present(item, field))
    .map(([field, label]) => ({ field, label }))
}

function appendOnlineIdentifiers(parts, item) {
  const url = firstIdentifier(item.identifiers, 'URL') || clean(item.url)
  const doi = normalizeDoi(firstIdentifier(item.identifiers, 'DOI') || item.doi)
  if (url) parts.push(url)
  if (doi) parts.push(`DOI:${doi}`)
}

function formatGB7714(item = {}, options = {}) {
  const normalizedType = normalizeType(item.itemType)
  const code = TYPE_CODES[normalizedType]
  const author = formatAuthors(item)
  const title = clean(item.title) || '[题名缺失]'
  const prefix = Number.isInteger(options.sequence) && options.sequence > 0 ? `[${options.sequence}]` : ''
  const head = `${prefix}${author}. ${title}[${code}]`
  const parts = []

  if (normalizedType === 'journal') {
    const serial = []
    if (clean(item.containerTitle)) serial.push(clean(item.containerTitle))
    const year = yearOf(item.issued)
    const volume = clean(item.volume)
    const issue = clean(item.issue)
    const chronology = [year, volume].filter(Boolean).join(', ')
    const issueText = issue ? `${chronology ? '' : year ? ', ' : ''}(${issue})` : ''
    const pageText = clean(item.pages) ? `: ${clean(item.pages)}` : ''
    const serialDetails = `${chronology}${issueText}${pageText}`
    if (serialDetails) serial.push(serialDetails)
    parts.push(serial.join(', '))
  } else if (normalizedType === 'conference' && clean(item.containerTitle)) {
    parts.push(`//${clean(item.containerTitle)}. ${joinPublication(item.publisherPlace, item.publisher, item.issued, item.pages)}`)
  } else if (['book', 'conference', 'thesis', 'report'].includes(normalizedType)) {
    parts.push(joinPublication(item.publisherPlace, item.publisher, item.issued, item.pages))
  } else if (normalizedType === 'web') {
    if (clean(item.issued)) parts.push(`(${dateOf(item.issued)})${clean(item.accessed) ? `[${dateOf(item.accessed)}]` : ''}`)
    else if (clean(item.accessed)) parts.push(`[${dateOf(item.accessed)}]`)
  } else if (clean(item.issued)) {
    parts.push(yearOf(item.issued))
  }

  const contentParts = [head, ...parts.filter(Boolean)]
  appendOnlineIdentifiers(contentParts, item)
  const text = `${contentParts.join('. ')}.`
    .replace('[C]. //', '[C]//')
    .replace(/\.{2,}$/u, '.')
  const missing = missingMetadata(item, normalizedType)
  return {
    standard: STANDARD,
    styleId: 'china-national-standard-gb-t-7714-2015-numeric',
    documentType: code,
    text,
    missingFields: missing,
    incomplete: missing.length > 0,
  }
}

function formatAPA(item = {}) {
  const normalizedType = normalizeType(item.itemType)
  const missing = missingMetadata(item, normalizedType)
  const authors = formatApaAuthors(item)
  const year = yearOf(item.issued) || 'n.d.'
  const title = clean(item.title) || '[Untitled]'
  const doi = normalizeDoi(firstIdentifier(item.identifiers, 'DOI') || item.doi)
  const url = firstIdentifier(item.identifiers, 'URL') || clean(item.url)
  const parts = [`${authors} (${year}). ${title}.`]
  if (normalizedType === 'journal') {
    const journal = clean(item.containerTitle)
    const volumeIssue = `${clean(item.volume)}${clean(item.issue) ? `(${clean(item.issue)})` : ''}`
    const publication = [journal, volumeIssue].filter(Boolean).join(', ')
    const pages = clean(item.pages)
    if (publication || pages) parts.push(`${publication}${pages ? `${publication ? ', ' : ''}${pages}` : ''}.`)
  } else if (['book', 'conference', 'thesis', 'report'].includes(normalizedType)) {
    const publisher = clean(item.publisher)
    if (publisher) parts.push(`${publisher}.`)
  }
  if (doi) parts.push(`https://doi.org/${doi}`)
  else if (url) parts.push(url)
  return { standard: 'APA 7th', styleId: 'apa-7', documentType: TYPE_CODES[normalizedType], text: parts.join(' ').replace(/\s+/g, ' ').trim(), missingFields: missing, incomplete: missing.length > 0 }
}

function formatIEEE(item = {}, options = {}) {
  const normalizedType = normalizeType(item.itemType)
  const missing = missingMetadata(item, normalizedType)
  const prefix = Number.isInteger(options.sequence) && options.sequence > 0 ? `[${options.sequence}] ` : ''
  const authors = formatIeeeAuthors(item)
  const title = clean(item.title) || '[Untitled]'
  const parts = [`${prefix}${authors}, “${title},”`]
  if (normalizedType === 'journal') {
    if (clean(item.containerTitle)) parts.push(clean(item.containerTitle))
    if (clean(item.volume)) parts.push(`vol. ${clean(item.volume)}`)
    if (clean(item.issue)) parts.push(`no. ${clean(item.issue)}`)
    if (clean(item.pages)) parts.push(`pp. ${clean(item.pages)}`)
    if (yearOf(item.issued)) parts.push(yearOf(item.issued))
  } else {
    if (clean(item.containerTitle)) parts.push(`in ${clean(item.containerTitle)}`)
    if (clean(item.publisher)) parts.push(clean(item.publisher))
    if (yearOf(item.issued)) parts.push(yearOf(item.issued))
  }
  const doi = normalizeDoi(firstIdentifier(item.identifiers, 'DOI') || item.doi)
  const url = firstIdentifier(item.identifiers, 'URL') || clean(item.url)
  if (doi) parts.push(`doi: ${doi}`)
  else if (url) parts.push(`[Online]. Available: ${url}`)
  const [head, ...details] = parts.filter(Boolean)
  return { standard: 'IEEE', styleId: 'ieee', documentType: TYPE_CODES[normalizedType], text: `${head}${details.length ? ` ${details.join(', ')}` : ''}.`.replace(/\.\.$/, '.'), missingFields: missing, incomplete: missing.length > 0 }
}

function bibtexEscape(value) {
  return clean(value).replace(/([{}])/g, '\\$1').replace(/&/g, '\\&').replace(/%/g, '\\%')
}

function bibtexKey(item) {
  const first = people(item)[0]?.family || 'ref'
  const ascii = first.normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  const titleWord = clean(item.title).normalize('NFKD').split(/\s+/).map(word => word.replace(/[^a-zA-Z0-9]/g, '')).find(Boolean)?.toLowerCase() || ''
  const year = yearOf(item.issued).replace(/\D/g, '')
  const readable = `${ascii || 'ref'}${year}${titleWord}`.slice(0, 48)
  if (readable !== 'ref') return readable
  return `ref${crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 10)}`
}

function formatBibTeX(item = {}) {
  const normalizedType = normalizeType(item.itemType)
  const entryType = { journal: 'article', book: 'book', conference: 'inproceedings', thesis: 'phdthesis', report: 'techreport', web: 'online', unknown: 'misc' }[normalizedType]
  const fields = []
  const authorText = people(item).map(person => [person.family, person.given].filter(Boolean).join(', ')).join(' and ')
  const add = (name, value) => { if (clean(value)) fields.push(`  ${name} = {${bibtexEscape(value)}}`) }
  add('author', authorText)
  add('title', item.title)
  add(normalizedType === 'journal' ? 'journal' : normalizedType === 'conference' ? 'booktitle' : 'publisher', normalizedType === 'journal' || normalizedType === 'conference' ? item.containerTitle : item.publisher)
  add('year', yearOf(item.issued))
  add('volume', item.volume)
  add('number', item.issue)
  add('pages', item.pages)
  const doi = normalizeDoi(firstIdentifier(item.identifiers, 'DOI') || item.doi)
  const url = firstIdentifier(item.identifiers, 'URL') || clean(item.url)
  add('doi', doi)
  add('url', url)
  const missing = missingMetadata(item, normalizedType)
  return { standard: 'BibTeX', styleId: 'bibtex', documentType: entryType, text: `@${entryType}{${bibtexKey(item)},\n${fields.join(',\n')}\n}`, missingFields: missing, incomplete: missing.length > 0 }
}

class GB7714Formatter {
  format(item, options) {
    return formatGB7714(item, options)
  }
}

class CitationFormatter {
  constructor(formatter = new GB7714Formatter()) {
    this.formatter = formatter
  }

  format(item, options = {}) {
    const style = options.style || 'gb-t-7714-2015'
    if (style === 'gb-t-7714-2015') return this.formatter.format(item, options)
    if (style === 'apa-7') return formatAPA(item, options)
    if (style === 'ieee') return formatIEEE(item, options)
    if (style === 'bibtex') return formatBibTeX(item, options)
    throw new Error(`不支持的引用格式：${style}`)
  }
}

module.exports = {
  CitationFormatter,
  CITATION_STYLES,
  GB7714Formatter,
  STANDARD,
  formatGB7714,
  formatAPA,
  formatBibTeX,
  formatIEEE,
  normalizeType,
}

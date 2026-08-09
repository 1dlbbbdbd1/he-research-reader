const STANDARD = 'GB/T 7714—2015'

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
    if (options.style && options.style !== 'gb-t-7714-2015') throw new Error(`不支持的引用格式：${options.style}`)
    return this.formatter.format(item, options)
  }
}

module.exports = {
  CitationFormatter,
  GB7714Formatter,
  STANDARD,
  formatGB7714,
  normalizeType,
}

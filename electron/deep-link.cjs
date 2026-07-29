function parseResearchReaderLink(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'research-reader:') return undefined
    if (url.hostname !== 'open') return undefined
    const sourceId = url.searchParams.get('sourceId')?.trim()
    const page = Number.parseInt(url.searchParams.get('page') || '', 10)
    const fragmentId = url.searchParams.get('fragmentId')?.trim() || undefined
    if (!sourceId || sourceId.length > 160 || !/^[a-zA-Z0-9:_-]+$/.test(sourceId)) return undefined
    if (fragmentId && (fragmentId.length > 160 || !/^[a-zA-Z0-9:_-]+$/.test(fragmentId))) return undefined
    return {
      sourceId,
      pageNumber: Number.isInteger(page) && page > 0 ? page : undefined,
      fragmentId,
    }
  } catch {
    return undefined
  }
}

function findResearchReaderLink(argv) {
  return (Array.isArray(argv) ? argv : [])
    .map(parseResearchReaderLink)
    .find(Boolean)
}

module.exports = {
  findResearchReaderLink,
  parseResearchReaderLink,
}

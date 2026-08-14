const crypto = require('node:crypto')

const text = value => String(value ?? '').trim()
const list = value => Array.isArray(value) ? value : []
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const stableId = (value, prefix) => `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 10)}`
const escapeXml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function parsedGoal(goalText) {
  const lines = text(goalText).replace(/\r\n?/g, '\n').split('\n').map((line, index) => ({ lineNumber: index + 1, raw: line, clean: line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim() })).filter(item => item.clean)
  const nodes = []; const edges = []; const byLabel = new Map()
  const ensure = (label, source) => {
    const key = text(label)
    if (!key) return undefined
    if (byLabel.has(key)) return byLabel.get(key)
    const node = { id: stableId(`${source.lineNumber}|${key}`, 'node'), label: key, kind: nodes.length === 0 ? 'goal' : 'step', sourceRef: { kind: 'input_line', lineNumber: source.lineNumber, text: source.raw } }
    nodes.push(node); byLabel.set(key, node); return node
  }
  for (const line of lines) {
    const chain = line.clean.split(/\s*(?:->|→|=>|⇒)\s*/).filter(Boolean)
    if (chain.length > 1) {
      const chainNodes = chain.map(label => ensure(label, line))
      for (let index = 0; index < chainNodes.length - 1; index += 1) edges.push({ id: stableId(`${chainNodes[index].id}|${chainNodes[index + 1].id}`, 'edge'), source: chainNodes[index].id, target: chainNodes[index + 1].id, label: '' })
    } else ensure(line.clean, line)
  }
  if (!edges.length && nodes.length > 1) for (let index = 0; index < nodes.length - 1; index += 1) edges.push({ id: stableId(`${nodes[index].id}|${nodes[index + 1].id}`, 'edge'), source: nodes[index].id, target: nodes[index + 1].id, label: '下一步' })
  return { nodes, edges }
}

function normalizeRoadmap(input = {}) {
  const parsed = list(input.nodes).length ? { nodes: list(input.nodes), edges: list(input.edges) } : parsedGoal(input.goalText)
  if (!parsed.nodes.length) throw new Error('没有可生成路线图的节点；请填写文字目标或结构化节点。')
  const ids = new Set()
  const nodes = parsed.nodes.map((item, index) => {
    const value = object(item); const label = text(value.label || value.text)
    if (!label) throw new Error(`第 ${index + 1} 个节点没有标签。`)
    const id = text(value.id) || stableId(`${index}|${label}`, 'node')
    if (ids.has(id)) throw new Error(`路线图节点 ID 重复：${id}`)
    ids.add(id)
    return { id, label, kind: text(value.kind) || (index === 0 ? 'goal' : 'step'), sourceRef: object(value.sourceRef), x: Number.isFinite(Number(value.x)) ? Number(value.x) : undefined, y: Number.isFinite(Number(value.y)) ? Number(value.y) : undefined }
  })
  const edgeIds = new Set()
  const edges = parsed.edges.map((item, index) => {
    const value = object(item); const source = text(value.source); const target = text(value.target)
    if (!ids.has(source) || !ids.has(target)) throw new Error(`第 ${index + 1} 条连线指向不存在的节点。`)
    if (source === target) throw new Error(`第 ${index + 1} 条连线不能连接节点自身。`)
    const id = text(value.id) || stableId(`${source}|${target}|${index}`, 'edge')
    if (edgeIds.has(id)) throw new Error(`路线图连线 ID 重复：${id}`)
    edgeIds.add(id)
    return { id, source, target, label: text(value.label), sourceRef: object(value.sourceRef) }
  })
  const incoming = new Map(nodes.map(node => [node.id, 0])); const outgoing = new Map(nodes.map(node => [node.id, []]))
  edges.forEach(edge => { incoming.set(edge.target, incoming.get(edge.target) + 1); outgoing.get(edge.source).push(edge.target) })
  const queue = nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id); const level = new Map(queue.map(id => [id, 0])); let visited = 0
  while (queue.length) {
    const id = queue.shift(); visited += 1
    for (const target of outgoing.get(id)) { incoming.set(target, incoming.get(target) - 1); level.set(target, Math.max(level.get(target) || 0, (level.get(id) || 0) + 1)); if (incoming.get(target) === 0) queue.push(target) }
  }
  const counts = new Map()
  const laidOut = nodes.map((node, index) => {
    const depth = level.get(node.id) ?? 0; const row = counts.get(depth) || 0; counts.set(depth, row + 1)
    return { ...node, x: node.x ?? 70 + depth * 280, y: node.y ?? 70 + row * 130 }
  })
  const degree = new Map(nodes.map(node => [node.id, 0])); edges.forEach(edge => { degree.set(edge.source, degree.get(edge.source) + 1); degree.set(edge.target, degree.get(edge.target) + 1) })
  const qa = {
    passed: visited === nodes.length && (nodes.length === 1 || nodes.every(node => degree.get(node.id) > 0)) && nodes.every(node => node.label.length <= 80),
    nodeCount: nodes.length, edgeCount: edges.length,
    missingSourceRefs: nodes.filter(node => !Object.keys(node.sourceRef).length).map(node => node.id),
    orphanNodes: nodes.filter(node => nodes.length > 1 && degree.get(node.id) === 0).map(node => node.id),
    cycleDetected: visited !== nodes.length,
    textOverflowNodes: nodes.filter(node => node.label.length > 80).map(node => node.id),
    directionChecked: edges.every(edge => edge.source && edge.target && edge.source !== edge.target),
  }
  const data = { version: 1, title: text(input.title) || '研究技术路线图', nodes: laidOut, edges }
  const markdown = `# 可编辑路线图数据\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n\n- 节点：${qa.nodeCount}\n- 连线：${qa.edgeCount}\n- 孤立节点：${qa.orphanNodes.length}\n- 环路：${qa.cycleDetected ? '有' : '无'}\n- 文字溢出风险：${qa.textOverflowNodes.length}\n`
  return { data, qa, result: { type: 'roadmap_data', label: '可编辑路线图数据', content: markdown, data, sourceLinks: nodes.filter(node => Object.keys(node.sourceRef).length).map(node => ({ kind: 'input_text', nodeId: node.id, ...node.sourceRef })), reviewState: 'draft' } }
}

function qaRoadmap(input = {}) {
  const normalized = normalizeRoadmap({ ...object(input.data), nodes: object(input.data).nodes, edges: object(input.data).edges, title: object(input.data).title })
  if (!normalized.qa.passed) {
    const issues = []
    if (normalized.qa.cycleDetected) issues.push('检测到环路')
    if (normalized.qa.orphanNodes.length) issues.push(`孤立节点：${normalized.qa.orphanNodes.join('、')}`)
    if (normalized.qa.textOverflowNodes.length) issues.push(`文字过长：${normalized.qa.textOverflowNodes.join('、')}`)
    throw new Error(`路线图 QA 未通过：${issues.join('；')}`)
  }
  const markdown = `# 路线图 QA\n\n- 节点：${normalized.qa.nodeCount}\n- 连线：${normalized.qa.edgeCount}\n- 节点遗漏检查：${normalized.qa.missingSourceRefs.length ? `有 ${normalized.qa.missingSourceRefs.length} 个节点缺少原始文字映射` : '全部有来源映射'}\n- 孤立节点：无\n- 环路：无\n- 箭头方向：通过\n- 文字溢出：无\n`
  return { data: normalized.data, qa: normalized.qa, result: { type: 'roadmap_qa', label: '路线图 QA', content: markdown, data: normalized.qa, reviewState: 'draft' } }
}

function parseEditedRoadmap(input = {}) {
  const content = text(input.content)
  const fenced = content.match(/```json\s*([\s\S]*?)```/i)
  const candidate = text(fenced?.[1] || content)
  let data
  try { data = JSON.parse(candidate) } catch { throw new Error('可编辑路线图结果中的 JSON 无法解析，请修正节点或连线格式。') }
  const normalized = normalizeRoadmap({ ...object(data), nodes: object(data).nodes, edges: object(data).edges, title: object(data).title })
  return { data: normalized.data, qa: normalized.qa, json: JSON.stringify(normalized.data, null, 2) }
}

function renderSvg(input = {}) {
  const data = object(input.data); const nodes = list(data.nodes); const edges = list(data.edges); const nodeById = new Map(nodes.map(node => [node.id, node]))
  const width = Math.max(720, ...nodes.map(node => Number(node.x) + 260)); const height = Math.max(360, ...nodes.map(node => Number(node.y) + 110))
  const lines = edges.map(edge => { const a = nodeById.get(edge.source); const b = nodeById.get(edge.target); return `<g data-edge-id="${escapeXml(edge.id)}"><path d="M ${a.x + 210} ${a.y + 42} L ${b.x} ${b.y + 42}" fill="none" stroke="#7461A8" stroke-width="2" marker-end="url(#arrow)"/><text x="${(a.x + 210 + b.x) / 2}" y="${(a.y + b.y) / 2 + 34}" text-anchor="middle" font-size="12" fill="#655B75">${escapeXml(edge.label)}</text></g>` }).join('')
  const boxes = nodes.map(node => `<g data-node-id="${escapeXml(node.id)}" data-source-ref="${escapeXml(JSON.stringify(node.sourceRef || {}))}"><rect x="${node.x}" y="${node.y}" width="210" height="84" rx="14" fill="${node.kind === 'goal' ? '#EEF0FF' : '#FAF8FD'}" stroke="${node.kind === 'goal' ? '#4B2CFF' : '#A99CC8'}" stroke-width="2"/><foreignObject x="${node.x + 12}" y="${node.y + 12}" width="186" height="60"><div xmlns="http://www.w3.org/1999/xhtml" style="font:600 14px/1.35 'Microsoft YaHei',sans-serif;color:#182043;text-align:center;overflow-wrap:anywhere">${escapeXml(node.label)}</div></foreignObject></g>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#7461A8"/></marker></defs><rect width="100%" height="100%" fill="#FFFFFF"/><text x="36" y="38" font-family="Microsoft YaHei,sans-serif" font-size="21" font-weight="700" fill="#101A4B">${escapeXml(data.title || '研究技术路线图')}</text>${lines}${boxes}</svg>`
  return { svg, width, height }
}

function renderDrawio(input = {}) {
  const data = object(input.data); const nodes = list(data.nodes); const edges = list(data.edges)
  const cells = nodes.map(node => `<mxCell id="${escapeXml(node.id)}" value="${escapeXml(node.label)}" style="rounded=1;whiteSpace=wrap;html=1;strokeColor=#7461A8;fillColor=#FAF8FD;" vertex="1" parent="1" sourceRef="${escapeXml(JSON.stringify(node.sourceRef || {}))}"><mxGeometry x="${node.x}" y="${node.y}" width="210" height="84" as="geometry"/></mxCell>`).join('')
  const edgeCells = edges.map(edge => `<mxCell id="${escapeXml(edge.id)}" value="${escapeXml(edge.label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;" edge="1" parent="1" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`).join('')
  const xml = `<mxfile host="小何的科研助手" version="1"><diagram id="roadmap" name="${escapeXml(data.title || '研究技术路线图')}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}${edgeCells}</root></mxGraphModel></diagram></mxfile>`
  return { xml }
}

module.exports = { normalizeRoadmap, parseEditedRoadmap, qaRoadmap, renderDrawio, renderSvg }

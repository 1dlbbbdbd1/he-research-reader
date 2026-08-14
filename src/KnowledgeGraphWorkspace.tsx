import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, CircleDot, Link2, Network, RefreshCw, Save, ShieldCheck, X } from 'lucide-react'
import './knowledge-graph.css'

type GraphState = {
  nodes: DesktopKnowledgeNode[]
  edges: DesktopKnowledgeEdge[]
  summary: { nodes: number; edges: number; draftNodes: number; draftEdges: number }
}

type NodePosition = { x: number; y: number }
type GraphLayout = { positions: Map<string, NodePosition>; height: number }

const nodeTypeLabels: Record<DesktopKnowledgeNode['type'], string> = {
  paper: '论文', author: '作者', concept: '概念', method: '方法', experiment: '实验',
  dataset: '数据集', code: '代码', idea: '想法', claim: '论断', evidence: '证据',
}

const edgeTypeLabels: Record<DesktopKnowledgeEdge['type'], string> = {
  authored_by: '作者', mentions: '提及', proposes: '提出', uses: '使用', validated_by: '由…验证',
  derived_from: '源自', supports: '支持', contradicts: '反驳', related_to: '相关',
}

function layoutFor(nodes: DesktopKnowledgeNode[]): GraphLayout {
  const lanes: Array<DesktopKnowledgeNode['type'][]> = [
    ['paper', 'author', 'evidence'],
    ['concept', 'method', 'idea', 'claim'],
    ['experiment', 'dataset', 'code'],
  ]
  const positions = new Map<string, NodePosition>()
  let maximumLaneSize = 0
  lanes.forEach((lane, laneIndex) => {
    const laneNodes = nodes.filter(node => lane.includes(node.type)).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    maximumLaneSize = Math.max(maximumLaneSize, laneNodes.length)
    laneNodes.forEach((node, index) => {
      positions.set(node.id, {
        x: 16.5 + laneIndex * 33.5,
        y: 82 + index * 86,
      })
    })
  })
  return { positions, height: Math.max(565, 126 + maximumLaneSize * 86) }
}

function stateLabel(state: DesktopKnowledgeNode['reviewState']) {
  return state === 'draft' ? '待确认' : state === 'confirmed' ? '已确认' : state === 'rejected' ? '已拒绝' : '已归档'
}

export default function KnowledgeGraphWorkspace({
  workspaceReady,
  onOpenSource,
  onNotify,
}: {
  workspaceReady: boolean
  onOpenSource: (sourceId: string, pageNumber?: number) => void
  onNotify: (message: string) => void
}) {
  const [graph, setGraph] = useState<GraphState>({ nodes: [], edges: [], summary: { nodes: 0, edges: 0, draftNodes: 0, draftEdges: 0 } })
  const [cards, setCards] = useState<DesktopEvidenceCard[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<DesktopKnowledgeNode['type'] | 'all'>('all')
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [editingCard, setEditingCard] = useState<DesktopEvidenceCard>()
  const [understanding, setUnderstanding] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)

  async function refresh() {
    const desktop = window.readerDesktop
    if (!desktop || !workspaceReady) return
    setLoading(true)
    try {
      const bootstrapped = await desktop.bootstrapKnowledgeGraph()
      const evidenceCards = await desktop.listEvidenceCards()
      setGraph({
        nodes: bootstrapped.graph.nodes,
        edges: bootstrapped.graph.edges,
        summary: {
          nodes: bootstrapped.graph.summary.nodes ?? bootstrapped.graph.nodes.length,
          edges: bootstrapped.graph.summary.edges ?? bootstrapped.graph.edges.length,
          draftNodes: bootstrapped.graph.summary.draftNodes ?? 0,
          draftEdges: bootstrapped.graph.summary.draftEdges ?? 0,
        },
      })
      setCards(evidenceCards)
      setSelectedNodeId(current => current && bootstrapped.graph.nodes.some(node => node.id === current) ? current : bootstrapped.graph.nodes[0]?.id)
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '知识图谱读取失败。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [workspaceReady])

  const visibleNodes = useMemo(() => filter === 'all' ? graph.nodes : graph.nodes.filter(node => node.type === filter), [filter, graph.nodes])
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes])
  const visibleEdges = useMemo(() => graph.edges.filter(edge => visibleNodeIds.has(edge.fromNodeId) && visibleNodeIds.has(edge.toNodeId)), [graph.edges, visibleNodeIds])
  const graphLayout = useMemo(() => layoutFor(visibleNodes), [visibleNodes])
  const positions = graphLayout.positions
  const selectedNode = graph.nodes.find(node => node.id === selectedNodeId)
  const selectedEdges = selectedNode ? graph.edges.filter(edge => edge.fromNodeId === selectedNode.id || edge.toNodeId === selectedNode.id) : []
  const draftNodes = graph.nodes.filter(node => node.reviewState === 'draft')
  const draftEdges = graph.edges.filter(edge => edge.reviewState === 'draft')

  async function reviewNode(id: string, decision: 'confirm' | 'reject') {
    try {
      await window.readerDesktop?.reviewKnowledgeNode({ id, decision })
      await refresh()
      onNotify(decision === 'confirm' ? '知识节点已人工确认。' : '知识节点已拒绝。')
    } catch (error) { onNotify(error instanceof Error ? error.message : '节点审核失败。') }
  }

  async function reviewEdge(edge: DesktopKnowledgeEdge, decision: 'confirm' | 'reject') {
    try {
      await window.readerDesktop?.reviewKnowledgeEdge({ id: edge.id, decision })
      await refresh()
      onNotify(decision === 'confirm' ? '知识关系已人工确认。' : '知识关系已拒绝。')
    } catch (error) { onNotify(error instanceof Error ? error.message : '关系审核失败。') }
  }

  function editCard(card: DesktopEvidenceCard) {
    setEditingCard(card)
    setUnderstanding(card.understanding)
    setTags(card.tags.join('，'))
  }

  async function saveCard() {
    if (!editingCard || !window.readerDesktop) return
    setSaving(true)
    try {
      await window.readerDesktop.updateEvidenceCard({
        id: editingCard.id,
        understanding,
        tags: tags.split(/[，,]/).map(item => item.trim()).filter(Boolean),
        createdBy: 'user',
      })
      setEditingCard(undefined)
      await refresh()
      onNotify('Evidence Card 已保存；原文未改动，理解作为新版本追加。')
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Evidence Card 保存失败。') }
    finally { setSaving(false) }
  }

  if (!workspaceReady) return <div className="knowledge-empty"><Network size={38}/><h2>请先创建或打开研究库</h2><p>知识图谱只读取当前本地研究库，不会跨项目混合数据。</p></div>

  return <main className="knowledge-workspace">
    <header className="knowledge-page-header">
      <div><p className="eyebrow">Research knowledge graph</p><h1>科研知识图谱</h1><p>论文、方法、证据和实验保持可追溯连接；AI 只能提议，确认权在你。</p></div>
      <button className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'spinning' : ''}/>重建图谱</button>
    </header>

    <section className="knowledge-summary" aria-label="知识图谱概况">
      <div><strong>{graph.summary.nodes}</strong><span>节点</span></div>
      <div><strong>{graph.summary.edges}</strong><span>关系</span></div>
      <div className="review"><strong>{graph.summary.draftNodes + graph.summary.draftEdges}</strong><span>待你确认</span></div>
      <div><strong>{cards.length}</strong><span>Evidence Cards</span></div>
    </section>

    <div className="knowledge-layout">
      <section className="knowledge-graph-panel">
        <div className="knowledge-toolbar" role="toolbar" aria-label="节点类型筛选">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button>
          {Object.entries(nodeTypeLabels).map(([type, label]) => <button key={type} className={filter === type ? 'active' : ''} onClick={() => setFilter(type as DesktopKnowledgeNode['type'])}>{label}</button>)}
        </div>
        <div className="knowledge-network-scroll">
        <div className="knowledge-network" aria-label="可交互知识图谱" style={{ height: `${graphLayout.height}px` }}>
          <div className="knowledge-lane-labels"><span>论文与证据</span><span>研究理解</span><span>实验与产物</span></div>
          <svg viewBox={`0 0 100 ${graphLayout.height}`} preserveAspectRatio="none" aria-hidden="true" style={{ height: `${graphLayout.height}px` }}>
            {visibleEdges.map(edge => {
              const from = positions.get(edge.fromNodeId)
              const to = positions.get(edge.toNodeId)
              if (!from || !to) return null
              return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`${edge.reviewState} ${edge.origin}`}/>
            })}
          </svg>
          {visibleNodes.map(node => {
            const position = positions.get(node.id)!
            return <button
              key={node.id}
              className={`knowledge-node ${node.type} ${node.reviewState} ${selectedNodeId === node.id ? 'selected' : ''}`}
              style={{ left: `${position.x}%`, top: `${position.y}px` }}
              onClick={() => setSelectedNodeId(node.id)}
              title={`${nodeTypeLabels[node.type]} · ${stateLabel(node.reviewState)}`}
            ><span>{nodeTypeLabels[node.type]}</span><strong>{node.label}</strong>{node.reviewState === 'draft' && <small>待确认</small>}</button>
          })}
          {!loading && !visibleNodes.length && <div className="knowledge-network-empty"><CircleDot size={30}/><strong>当前筛选没有节点</strong><span>导入论文、提取原文证据或记录实验后可重建。</span></div>}
        </div>
        </div>
      </section>

      <aside className="knowledge-inspector">
        {selectedNode ? <>
          <div className="knowledge-node-heading"><span className={selectedNode.type}>{nodeTypeLabels[selectedNode.type]}</span><em className={selectedNode.reviewState}>{stateLabel(selectedNode.reviewState)}</em></div>
          <h2>{selectedNode.label}</h2>
          <p>{selectedNode.description || '此节点暂无补充说明。'}</p>
          <dl><div><dt>来源</dt><dd>{selectedNode.origin === 'ai_suggestion' ? 'AI 建议' : selectedNode.origin === 'source' ? '研究库来源' : selectedNode.origin}</dd></div><div><dt>实体 ID</dt><dd>{selectedNode.entityId}</dd></div></dl>
          {selectedNode.reviewState === 'draft' && <div className="knowledge-review-actions"><button onClick={() => void reviewNode(selectedNode.id, 'confirm')}><Check size={14}/>确认节点</button><button className="reject" onClick={() => void reviewNode(selectedNode.id, 'reject')}><X size={14}/>拒绝</button></div>}
          <section className="knowledge-related"><h3><Link2 size={15}/>直接关系</h3>{selectedEdges.map(edge => {
            const neighbor = graph.nodes.find(node => node.id === (edge.fromNodeId === selectedNode.id ? edge.toNodeId : edge.fromNodeId))
            return <article key={edge.id} className={edge.reviewState}>
              <button onClick={() => neighbor && setSelectedNodeId(neighbor.id)}><span>{edgeTypeLabels[edge.type]}</span><strong>{neighbor?.label ?? '未知节点'}</strong></button>
              <small>{edge.evidenceRefs.length ? `${edge.evidenceRefs.length} 条证据` : '无证据，不可确认'}</small>
              {edge.reviewState === 'draft' && <div><button disabled={!edge.evidenceRefs.length} onClick={() => void reviewEdge(edge, 'confirm')}>确认</button><button onClick={() => void reviewEdge(edge, 'reject')}>拒绝</button></div>}
            </article>
          })}{!selectedEdges.length && <p className="knowledge-muted">尚无直接关系。</p>}</section>
        </> : <div className="knowledge-inspector-empty"><Network size={30}/><strong>选择一个节点</strong><span>这里会显示来源、审核状态和直接证据关系。</span></div>}
      </aside>
    </div>

    {(draftNodes.length > 0 || draftEdges.length > 0) && <section className="knowledge-review-queue">
      <header><div><ShieldCheck size={18}/><strong>人工审核队列</strong></div><span>{draftNodes.length} 个节点 · {draftEdges.length} 条关系</span></header>
      <div>{draftNodes.map(node => <article key={node.id}><span>节点 · {nodeTypeLabels[node.type]}</span><strong>{node.label}</strong><p>{node.description || 'AI 未提供说明。'}</p><footer><button onClick={() => void reviewNode(node.id, 'confirm')}>确认</button><button onClick={() => void reviewNode(node.id, 'reject')}>拒绝</button></footer></article>)}
      {draftEdges.map(edge => <article key={edge.id}><span>关系 · {edgeTypeLabels[edge.type]}</span><strong>{graph.nodes.find(node => node.id === edge.fromNodeId)?.label} → {graph.nodes.find(node => node.id === edge.toNodeId)?.label}</strong><p>{edge.rationale || 'AI 未提供关系依据。'}</p><small>{edge.evidenceRefs.length ? `已有 ${edge.evidenceRefs.length} 条证据` : '缺少证据，确认已禁用'}</small><footer><button disabled={!edge.evidenceRefs.length} onClick={() => void reviewEdge(edge, 'confirm')}>确认</button><button onClick={() => void reviewEdge(edge, 'reject')}>拒绝</button></footer></article>)}</div>
    </section>}

    <section className="evidence-card-section">
      <header><div><BookOpen size={18}/><div><strong>Evidence Cards</strong><span>原文 × 我的理解 × 位置 × 标签 × 实验</span></div></div><small>原文哈希锁定，编辑只会追加理解版本</small></header>
      <div className="evidence-card-grid">{cards.map(card => <article key={card.id} className={card.reviewState}>
        <header><span>{card.sourceName}{card.pageNumber ? ` · 第 ${card.pageNumber} 页` : ''}</span><em>{stateLabel(card.reviewState)}</em></header>
        <blockquote>{card.original}</blockquote>
        <div className="evidence-understanding"><strong>我的理解</strong><p>{card.understanding || '尚未填写。'}</p></div>
        <div className="evidence-tags">{card.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        <footer><button onClick={() => onOpenSource(card.sourceId, card.pageNumber)}><BookOpen size={13}/>返回原文</button><button onClick={() => editCard(card)}><Save size={13}/>编辑理解</button></footer>
      </article>)}</div>
      {!cards.length && <div className="knowledge-card-empty">还没有原文证据卡。请在阅读器中提取有位置锚点的证据。</div>}
    </section>

    {editingCard && <div className="knowledge-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditingCard(undefined) }}>
      <section className="knowledge-card-editor" role="dialog" aria-modal="true" aria-label="编辑 Evidence Card">
        <header><div><span>Evidence Card</span><h2>记录我的理解</h2></div><button onClick={() => setEditingCard(undefined)} aria-label="关闭"><X size={18}/></button></header>
        <label>原文（只读）<blockquote>{editingCard.original}</blockquote></label>
        <label>我的理解<textarea rows={7} value={understanding} onChange={event => setUnderstanding(event.target.value)} placeholder="用自己的话解释证据，写清楚它为什么重要。"/></label>
        <label>标签<input value={tags} onChange={event => setTags(event.target.value)} placeholder="用逗号分隔，例如：复现，控制方法"/></label>
        <p>保存会创建新的理解片段并链接旧版本；不会覆盖原文证据。</p>
        <footer><button onClick={() => setEditingCard(undefined)}>取消</button><button className="primary-button" disabled={saving} onClick={() => void saveCard()}>{saving ? '保存中…' : '保存新版本'}</button></footer>
      </section>
    </div>}
  </main>
}

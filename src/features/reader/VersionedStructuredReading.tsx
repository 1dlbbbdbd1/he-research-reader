import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { AlertTriangle, ArrowDown, ArrowUp, BookOpen, History, RotateCcw, Save, Sparkles, X } from 'lucide-react'
import {
  buildAcademicMarkdownAIRequest,
  parseAcademicMarkdownBoundaries,
} from '../../academic-markdown-skill.mjs'

type AISettings = {
  baseUrl: string
  model: string
  apiKey: string
  allowFullDocument: boolean
}

type Paper = {
  title: string
  authors: Array<{ family?: string; given?: string; literal?: string }>
  issued?: string
  abstract?: string
  keywords: string[]
  containerTitle?: string
  identifiers: Record<string, string[]>
}

type LayoutBlock = { id: string; type: string; text: string; pageNumber: number; bbox?: [number, number, number, number] }

const changeLabels: Record<string, string> = {
  headingsRecognized: '识别标题',
  headingsInferred: '推断章节',
  paragraphsSplit: '拆分粘连段落',
  crossPageMerges: '合并跨页断句',
  reorderedBlocks: '调整阅读顺序',
  figuresLinked: '关联图表标题',
  qualityIssueCount: '质量提示',
  manualHeadingChanges: '手调标题',
}

const STRUCTURED_RENDER_CHUNK = 80

function generatedByLabel(value: DesktopStructuredReadingVersion['createdBy']) {
  return { rules: '本地规则', ai: 'AI 章节识别', user: '人工调整', restore: '版本恢复' }[value]
}

function headingText(content: string) {
  return content.trim().replace(/^#{1,6}\s*/, '')
}

export default function VersionedStructuredReading({
  sourceId,
  sourceName,
  rawMarkdown,
  paper,
  settings,
  activeMarkdownBlockId,
  presentation = 'full',
  showToc = true,
  onMineruLayoutBlocks,
  onSettings,
}: {
  sourceId: string
  sourceName: string
  rawMarkdown: string
  paper?: Paper
  settings: AISettings
  activeMarkdownBlockId?: string
  presentation?: 'full' | 'comparison'
  showToc?: boolean
  onMineruLayoutBlocks: (blocks: LayoutBlock[]) => void
  onSettings: () => void
}) {
  const [state, setState] = useState<DesktopStructuredReadingState>()
  const [assets, setAssets] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'structured' | 'raw'>('structured')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmAI, setConfirmAI] = useState(false)
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [headingLevels, setHeadingLevels] = useState<Record<string, number>>({})
  const [visibleBlockCount, setVisibleBlockCount] = useState(STRUCTURED_RENDER_CHUNK)
  const readerRef = useRef<HTMLElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const current = state?.currentVersion

  useEffect(() => {
    let disposed = false
    const desktop = window.readerDesktop
    setState(undefined)
    setAssets({})
    setNotice('正在读取结构化阅读稿…')
    setEditing(false)
    setHistoryOpen(false)
    setMode('structured')
    if (!desktop) return () => { disposed = true }
    void Promise.all([
      desktop.getStructuredReading({ sourceId }),
      desktop.loadMineruAssets({ sourceId }),
    ]).then(async ([saved, mineru]) => {
      if (disposed) return
      setAssets(mineru.assets)
      onMineruLayoutBlocks(mineru.layoutBlocks)
      if (!saved.currentVersion || saved.stale) {
        setNotice(saved.stale ? 'MinerU 原文已更新，正在重建结构化阅读稿…' : '正在生成首个结构化阅读稿…')
        const generated = await desktop.generateStructuredReading({ sourceId, createdBy: 'rules' })
        if (!disposed) setState(generated)
      } else {
        setState(saved)
      }
      if (!disposed) setNotice('')
    }).catch(error => {
      if (!disposed) setNotice(error instanceof Error ? error.message : '结构化阅读稿加载失败。')
    })
    return () => { disposed = true }
  }, [onMineruLayoutBlocks, sourceId, rawMarkdown])

  useEffect(() => {
    if (!current) return
    setOrderedIds(current.blocks.map(block => block.id))
    setHeadingLevels(Object.fromEntries(current.blocks.map(block => [block.id, block.headingLevel || 0])))
    setVisibleBlockCount(STRUCTURED_RENDER_CHUNK)
  }, [current?.id])

  useEffect(() => {
    if (!activeMarkdownBlockId || !current) return
    const index = current.blocks.findIndex(block => block.originalBlockIds.includes(activeMarkdownBlockId))
    if (index >= 0) setVisibleBlockCount(count => Math.max(count, index + 12))
    window.requestAnimationFrame(() => {
      const target = readerRef.current?.querySelector<HTMLElement>(`[data-markdown-block="${activeMarkdownBlockId}"]`)
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [activeMarkdownBlockId, current?.id])

  const blocks = useMemo(() => {
    if (!current) return []
    const byId = new Map(current.blocks.map(block => [block.id, block]))
    return editing ? orderedIds.map(id => byId.get(id)).filter(Boolean) as DesktopStructuredReadingBlock[] : current.blocks
  }, [current, editing, orderedIds])
  const visibleBlocks = useMemo(() => blocks.slice(0, visibleBlockCount), [blocks, visibleBlockCount])

  useEffect(() => {
    const root = readerRef.current
    const target = loadMoreRef.current
    if (!root || !target || visibleBlockCount >= blocks.length) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleBlockCount(count => Math.min(blocks.length, count + STRUCTURED_RENDER_CHUNK))
      }
    }, { root, rootMargin: '500px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [blocks.length, visibleBlockCount])

  function openTocBlock(blockId: string) {
    const index = blocks.findIndex(block => block.id === blockId)
    if (index >= 0) setVisibleBlockCount(count => Math.max(count, index + 12))
    window.requestAnimationFrame(() => readerRef.current?.querySelector<HTMLElement>(`[data-structured-block="${blockId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function resolvedImage(src?: string) {
    if (!src) return undefined
    const normalized = src.replace(/\\/g, '/')
    let decoded = normalized
    try { decoded = decodeURIComponent(normalized) } catch {}
    return assets[normalized] || assets[normalized.replace(/^\.\//, '')] || assets[decoded] || assets[decoded.replace(/^\.\//, '')]
  }

  function moveBlock(id: string, direction: -1 | 1) {
    setOrderedIds(currentIds => {
      const index = currentIds.indexOf(id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= currentIds.length) return currentIds
      const next = [...currentIds]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function saveAdjustment() {
    const desktop = window.readerDesktop
    if (!desktop || !current) return
    setBusy(true)
    setNotice('正在保存新的派生稿版本…')
    try {
      const next = await desktop.saveStructuredReadingAdjustment({
        sourceId,
        baseVersionId: current.id,
        orderedBlockIds: orderedIds,
        headingLevels,
        note: '用户在阅读器中调整结构块顺序或标题层级。',
      })
      setState(next)
      setEditing(false)
      setNotice('人工调整已保存为新版本；MinerU 原始 Markdown 未改动。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '结构调整保存失败。')
    } finally {
      setBusy(false)
    }
  }

  async function restoreVersion(versionId: string) {
    const desktop = window.readerDesktop
    if (!desktop) return
    setBusy(true)
    setNotice('正在从旧版本创建恢复版本…')
    try {
      setState(await desktop.restoreStructuredReadingVersion({ sourceId, versionId }))
      setEditing(false)
      setNotice('已恢复旧版结构，并保留全部历史。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '旧版本恢复失败。')
    } finally {
      setBusy(false)
    }
  }

  async function regenerateWithRules() {
    const desktop = window.readerDesktop
    if (!desktop) return
    setBusy(true)
    setNotice('正在根据 MinerU 版面证据生成本地整理稿…')
    try {
      setState(await desktop.generateStructuredReading({ sourceId, createdBy: 'rules' }))
      setNotice('本地整理稿已重新生成；PDF 与 MinerU 原始 Markdown 未改动。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '本地整理稿生成失败。')
    } finally {
      setBusy(false)
    }
  }

  function requestAI() {
    if (!settings.baseUrl || !settings.model || !settings.apiKey) {
      setNotice('尚未配置可用的 AI 服务。请先在设置中填写服务地址、模型和密钥。')
      return
    }
    if (!settings.allowFullDocument) {
      setNotice('当前未允许发送整篇派生 Markdown。请先在设置中显式开启；原 PDF 不会发送。')
      return
    }
    setConfirmAI(true)
  }

  async function generateWithAI() {
    const desktop = window.readerDesktop
    if (!desktop) return
    setBusy(true)
    setNotice(`正在让 ${settings.model} 识别章节边界；返回的正文不会被采用。`)
    try {
      const request = buildAcademicMarkdownAIRequest({ markdown: rawMarkdown, paper })
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
        }),
      })
      if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const boundaries = parseAcademicMarkdownBoundaries(data.choices?.[0]?.message?.content || '', rawMarkdown)
      setState(await desktop.generateStructuredReading({ sourceId, createdBy: 'ai', model: settings.model, boundaries }))
      setConfirmAI(false)
      setNotice(`已保存 ${boundaries.length} 个章节边界为新版本；正文仍来自原始块。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 章节识别失败。')
    } finally {
      setBusy(false)
    }
  }

  const previousVersion = state?.versions.find(version => version.id !== current?.id)
  const comparison = presentation === 'comparison'
  const effectiveMode = comparison ? 'structured' : mode
  return <article ref={readerRef} className={`versioned-structured-reader ${comparison ? 'comparison' : ''}`}>
    <header className="versioned-structured-header">
      <div>
        <span>整理稿 · 保留原文证据</span>
        <strong>{paper?.title || sourceName.replace(/\.[^.]+$/, '')}</strong>
        {current && <small>当前：{generatedByLabel(current.createdBy)} v{current.versionNumber} · {current.blocks.length} 个结构块 · 原文指纹 {current.sourceFingerprint.slice(0, 10)}</small>}
      </div>
      {!comparison && <div className="versioned-structured-actions">
        <div className="structured-mode-switch">
          <button className={mode === 'structured' ? 'active' : ''} onClick={() => setMode('structured')}>整理稿</button>
          <button className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>原始 MD</button>
        </div>
        <button onClick={() => setHistoryOpen(value => !value)}><History size={14}/>版本</button>
        {previousVersion && <button disabled={busy} onClick={() => void restoreVersion(previousVersion.id)}><RotateCcw size={14}/>撤销</button>}
        <button disabled={busy || !current} onClick={() => setEditing(value => !value)}>{editing ? <X size={14}/> : <BookOpen size={14}/>} {editing ? '退出调整' : '调整结构'}</button>
        <button disabled={busy} onClick={requestAI}><Sparkles size={14}/>使用 AI 再整理</button>
      </div>}
    </header>

    {notice && <div className="structured-reading-notice"><span>{notice}</span>{notice.includes('设置') && <button onClick={onSettings}>打开设置</button>}</div>}

    {!comparison && confirmAI && <section className="academic-ai-confirm">
      <div><strong>确认让 AI 进一步识别章节结构？</strong><p>将发送题录和约 {rawMarkdown.length.toLocaleString('zh-CN')} 个字符到 {settings.model}。AI 只返回原始块 ID 对应的章节边界，不采用 AI 改写正文；PDF、原始 MD 和用户笔记不会被覆盖。</p></div>
      <button onClick={() => setConfirmAI(false)}>取消</button>
      <button className="confirm" disabled={busy} onClick={() => void generateWithAI()}>{busy ? '识别中…' : '确认发送'}</button>
    </section>}

    {!comparison && historyOpen && <section className="structured-version-history">
      <header><strong>派生稿版本</strong><span>恢复会创建新版本，不覆盖历史</span></header>
      {state?.versions.map(version => <div key={version.id} className={version.id === current?.id ? 'current' : ''}>
        <span><b>v{version.versionNumber}</b>{generatedByLabel(version.createdBy)} · {new Date(version.createdAt).toLocaleString('zh-CN')}</span>
        <small>{version.note || '无版本说明'}{version.qualityIssueCount ? ` · ${version.qualityIssueCount} 条提示` : ''}</small>
        {version.id !== current?.id && <button disabled={busy} onClick={() => void restoreVersion(version.id)}>恢复此版</button>}
      </div>)}
    </section>}

    {!comparison && current && <section className="structured-change-summary">
      <div><strong>本版变化</strong><span>所有正文片段仍指向 MinerU 原始块</span></div>
      {Object.entries(current.changeSummary).filter(([key, value]) => changeLabels[key] && typeof value === 'number' && value > 0).map(([key, value]) => <span key={key}><b>{String(value)}</b>{changeLabels[key]}</span>)}
    </section>}

    {!comparison && current?.qualityIssues.length ? <section className="structured-quality-issues">
      <header><AlertTriangle size={15}/><strong>需要人工核查</strong><span>{current.qualityIssues.length}</span></header>
      {current.qualityIssues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.pageNumber ? `第 ${issue.pageNumber} 页 · ` : ''}{issue.message}</p>)}
    </section> : null}

    {effectiveMode === 'raw' ? <pre className="structured-raw-markdown">{rawMarkdown}</pre> : current ? <div className={`versioned-structured-body ${editing ? 'editing' : ''} ${comparison ? 'comparison' : ''}`}>
      {showToc && current.toc.length > 1 && !editing && <nav className="structured-toc"><strong>章节目录</strong>{current.toc.map(entry => <button key={`${entry.blockId}-${entry.title}`} style={{ paddingLeft: `${10 + (entry.level - 1) * 10}px` }} onClick={() => openTocBlock(entry.blockId)}>{entry.title}</button>)}</nav>}
      <div className="versioned-structured-content">
        {visibleBlocks.map((block, index) => <section
          key={block.id}
          data-structured-block={block.id}
          data-markdown-block={block.originalBlockIds[0]}
          data-markdown-page={block.pageNumber}
          className={`structured-version-block kind-${block.kind} ${activeMarkdownBlockId && block.originalBlockIds.includes(activeMarkdownBlockId) ? 'active-anchor' : ''}`}
        >
          {block.originalBlockIds.slice(1).map(originalId => <span key={originalId} data-markdown-block={originalId} className="structured-source-anchor"/>)}
          {editing && <div className="structured-block-editor">
            <span>块 {index + 1} · {block.originalBlockIds.join(' + ')}</span>
            <select value={headingLevels[block.id] ?? 0} onChange={event => setHeadingLevels(currentLevels => ({ ...currentLevels, [block.id]: Number(event.target.value) }))} aria-label={`块 ${index + 1} 标题层级`}>
              <option value={0}>正文/原类型</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>H{level} 标题</option>)}
            </select>
            <button disabled={index === 0} onClick={() => moveBlock(block.id, -1)} title="上移"><ArrowUp size={13}/></button>
            <button disabled={index === blocks.length - 1} onClick={() => moveBlock(block.id, 1)} title="下移"><ArrowDown size={13}/></button>
          </div>}
          {block.inferredHeading && block.kind !== 'heading' && <h2 className="academic-inferred-heading">{block.inferredHeading}</h2>}
          {Number(editing ? headingLevels[block.id] : block.headingLevel || 0) > 0
            ? createElement(`h${editing ? headingLevels[block.id] : block.headingLevel}`, {}, headingText(block.content))
            : <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              skipHtml
              components={{
                a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                img: ({ src, alt }) => {
                  const localImage = resolvedImage(src)
                  return localImage ? <img src={localImage} alt={alt || ''} loading="lazy"/> : <span className="markdown-image-missing">图片未包含在当前 MinerU 版本中{alt ? `：${alt}` : ''}</span>
                },
              }}
            >{block.content}</ReactMarkdown>}
          <footer><span>{block.pageRange ? `第 ${block.pageRange[0]}–${block.pageRange[1]} 页` : block.pageNumber ? `第 ${block.pageNumber} 页` : '页码待核对'}</span><span>{block.originalBlockIds.join(' · ')}</span>{block.transformation && <span>高置信度跨页合并</span>}</footer>
        </section>)}
        {visibleBlockCount < blocks.length && <div ref={loadMoreRef} className="structured-render-more"><span>已加载 {visibleBlocks.length}/{blocks.length} 个结构块</span><button onClick={() => setVisibleBlockCount(count => Math.min(blocks.length, count + STRUCTURED_RENDER_CHUNK))}>继续加载</button></div>}
      </div>
      {editing && <div className="structured-edit-save"><span>保存会创建新版本；不会修改原始 Markdown。</span><button className="primary-button" disabled={busy} onClick={() => void saveAdjustment()}><Save size={14}/>{busy ? '保存中…' : '保存新版本'}</button></div>}
    </div> : <div className="reader-empty-state"><BookOpen size={28}/><strong>{busy || /正在/.test(notice) ? '正在建立本地整理稿' : '整理稿尚未生成'}</strong><span>{notice || '原始 Markdown 会原样保留。'}</span>{!busy && notice && !/正在/.test(notice) && <button className="primary-button" onClick={() => void regenerateWithRules()}><RotateCcw size={14}/>重新生成本地整理稿</button>}</div>}
  </article>
}

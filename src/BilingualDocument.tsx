import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import {
  BookMarked, Cloud, HardDrive, Languages, Lock, Pencil, RotateCcw,
  Save, Settings2, Square, Trash2, Unlock, WifiOff, X,
} from 'lucide-react'
import {
  buildBilingualReadingPairs,
  createBilingualReadingDocument,
  markBilingualBatchTranslating,
  retryFailedBilingualSegments,
  selectBilingualTranslationBatch,
  updateBilingualSegment,
  type BilingualReadingDocument as BilingualDocumentState,
  type BilingualSegment,
} from './bilingual-reading.mjs'

type BilingualSettings = {
  baseUrl: string
  model: string
  apiKey: string
  allowFullDocument: boolean
  translationProvider: 'local' | 'ai'
}

type CachedTranslation = {
  segmentId: string
  sourceHash: string
  baseSourceHash?: string
  sourceText?: string
  translatedText?: string
  translation?: string
  provider?: string
  model?: string
  status?: string
  error?: string
  attempts?: number
  locked?: boolean
}

type TranslationCacheBridge = {
  getReadingTranslationSegments?: (input: {
    sourceId: string
    segments: Array<{ segmentId: string; sourceHash: string }>
  }) => Promise<CachedTranslation[] | { segments: CachedTranslation[] }>
  saveReadingTranslationSegment?: (input: {
    sourceId: string
    segmentId: string
    sourceHash: string
    baseSourceHash?: string
    sourceText: string
    translatedText?: string
    provider: 'local' | 'ai'
    model?: string
    status: 'pending' | 'translated' | 'failed'
    error?: string
    attempts?: number
    locked?: boolean
    unlock?: boolean
  }) => Promise<unknown>
  listReadingTranslationTerms?: (input: { sourceId: string }) => Promise<DesktopReadingTranslationTerm[]>
  saveReadingTranslationTerm?: (input: { sourceId: string; sourceTerm: string; targetTerm: string; note?: string }) => Promise<DesktopReadingTranslationTerm[]>
  deleteReadingTranslationTerm?: (input: { sourceId: string; termId: string }) => Promise<DesktopReadingTranslationTerm[]>
}

function markdownComponents(resolveImage: (src?: string) => string | undefined) {
  return {
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      const localImage = resolveImage(src)
      return localImage
        ? <img src={localImage} alt={alt || ''} loading="lazy"/>
        : <span className="markdown-image-missing">图片保留在原文版本中{alt ? `：${alt}` : ''}</span>
    },
  }
}

export default function BilingualDocument({
  sourceId,
  sourceRevision,
  text,
  title,
  settings,
  onSettings,
}: {
  sourceId: string
  sourceRevision?: string
  text?: string
  title: string
  settings: BilingualSettings
  onSettings: () => void
}) {
  const [documentState, setDocumentState] = useState<BilingualDocumentState>(() => createBilingualReadingDocument(text || ''))
  const [notice, setNotice] = useState('正在读取本地译文缓存…')
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [confirmCloud, setConfirmCloud] = useState<{ segmentId?: string }>()
  const [assets, setAssets] = useState<Record<string, string>>({})
  const [provider, setProvider] = useState<'local' | 'ai'>(settings.translationProvider || 'local')
  const [displayMode, setDisplayMode] = useState<'parallel' | 'source' | 'translation'>('parallel')
  const [editingSegment, setEditingSegment] = useState<{ id: string; text: string }>()
  const [segmentBusy, setSegmentBusy] = useState<string>()
  const [terms, setTerms] = useState<DesktopReadingTranslationTerm[]>([])
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [termDraft, setTermDraft] = useState({ sourceTerm: '', targetTerm: '', note: '' })
  const stopRef = useRef(false)

  useEffect(() => setProvider(settings.translationProvider || 'local'), [settings.translationProvider])

  useEffect(() => {
    let disposed = false
    const base = createBilingualReadingDocument(text || '')
    setDocumentState(base)
    setNotice(base.segments.some(segment => segment.translatable) ? '正在读取本地译文缓存…' : '当前内容没有可翻译的英文段落。')
    const desktop = window.readerDesktop as (Window['readerDesktop'] & TranslationCacheBridge) | undefined
    if (!desktop?.getReadingTranslationSegments || !base.segments.length) {
      setNotice(desktop ? '尚无译文缓存，可以开始翻译。' : '中英对照需要在桌面客户端中运行。')
      return () => { disposed = true }
    }
    void desktop.getReadingTranslationSegments({
      sourceId,
      segments: base.segments.filter(segment => segment.translatable).map(segment => ({ segmentId: segment.id, sourceHash: segment.contentHash })),
    }).then(result => {
      if (disposed) return
      const records = Array.isArray(result) ? result : result?.segments || []
      const cachedSegments = records
        .map(record => ({
          id: record.segmentId,
          contentHash: record.baseSourceHash || record.sourceHash,
          baseSourceHash: record.baseSourceHash || record.sourceHash,
          sourceHash: record.sourceHash,
          sourceText: record.sourceText,
          translation: record.translatedText || record.translation || '',
          status: record.status,
          error: record.error,
          attempts: record.attempts || 0,
          locked: Boolean(record.locked),
          provider: record.provider,
          model: record.model,
        }))
      const restored = createBilingualReadingDocument(text || '', { cachedSegments })
      setDocumentState(restored)
      const translated = restored.segments.filter(segment => segment.status === 'translated').length
      setNotice(translated ? `已恢复 ${translated} 段本地译文缓存。` : '尚无可复用译文，可以开始翻译。')
    }).catch(error => {
      if (!disposed) setNotice(error instanceof Error ? `译文缓存读取失败：${error.message}` : '译文缓存读取失败。')
    })
    return () => { disposed = true; stopRef.current = true }
  }, [sourceId, sourceRevision, text])

  useEffect(() => {
    let disposed = false
    const desktop = window.readerDesktop as (Window['readerDesktop'] & TranslationCacheBridge) | undefined
    if (!desktop?.listReadingTranslationTerms) return () => { disposed = true }
    void desktop.listReadingTranslationTerms({ sourceId })
      .then(result => { if (!disposed) setTerms(result) })
      .catch(() => { if (!disposed) setTerms([]) })
    return () => { disposed = true }
  }, [sourceId])

  useEffect(() => {
    let disposed = false
    setAssets({})
    const desktop = window.readerDesktop
    if (!desktop?.loadMineruAssets) return () => { disposed = true }
    void desktop.loadMineruAssets({ sourceId }).then(result => {
      if (!disposed) setAssets(result.assets)
    }).catch(() => { /* Images remain available in the authoritative PDF. */ })
    return () => { disposed = true }
  }, [sourceId, sourceRevision])

  const pairs = useMemo(() => buildBilingualReadingPairs(documentState.segments), [documentState.segments])
  const translatableCount = documentState.segments.filter(segment => segment.translatable).length
  const translatedCount = documentState.segments.filter(segment => segment.status === 'translated').length
  const failedCount = documentState.segments.filter(segment => segment.status === 'failed').length
  const pendingCount = documentState.segments.filter(segment => segment.translatable && ['pending', 'failed'].includes(segment.status)).length
  const pendingCharacters = documentState.segments
    .filter(segment => segment.translatable && !segment.locked && ['pending', 'failed'].includes(segment.status))
    .reduce((sum, segment) => sum + segment.translationSource.length, 0)
  const components = useMemo(() => markdownComponents(resolveImage), [assets])

  function resolveImage(src?: string) {
    if (!src) return undefined
    const normalized = src.replace(/\\/g, '/')
    let decoded = normalized
    try { decoded = decodeURIComponent(normalized) } catch { /* Keep the original path. */ }
    return assets[normalized] || assets[normalized.replace(/^\.\//, '')] || assets[decoded] || assets[decoded.replace(/^\.\//, '')]
  }

  async function persistSegment(segment: BilingualSegment, status: 'pending' | 'translated' | 'failed', translatedText?: string, error?: string, unlock = false) {
    const desktop = window.readerDesktop as (Window['readerDesktop'] & TranslationCacheBridge) | undefined
    if (!desktop?.saveReadingTranslationSegment) return
    await desktop.saveReadingTranslationSegment({
      sourceId,
      segmentId: segment.id,
      sourceHash: segment.translationSourceHash,
      baseSourceHash: segment.contentHash,
      sourceText: segment.translationSource,
      translatedText,
      provider,
      model: provider === 'ai' ? settings.model : 'Argos en_zh',
      status,
      error,
      attempts: segment.attempts,
      locked: segment.locked,
      unlock,
    })
  }

  async function translateSegment(segment: BilingualSegment) {
    const desktop = window.readerDesktop
    if (provider === 'local') {
      if (!desktop) throw new Error('本地翻译只在桌面客户端中运行。')
      const result = await desktop.translateLocally({ taskId: crypto.randomUUID(), text: segment.translationSource, from: 'en', to: 'zh' })
      return result.text
    }
    if (!settings.baseUrl || !settings.model || !settings.apiKey) throw new Error('尚未配置可用的 AI 翻译服务。')
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        messages: [
          { role: 'system', content: `忠实翻译英文工科论文段落为中文。保留 Markdown、公式、变量、数值、单位、引用编号和行内代码；不要总结、解释或增加原文没有的结论；只返回译文。${terms.length ? `\n术语表（必须优先使用）：\n${terms.map(term => `${term.sourceTerm} = ${term.targetTerm}`).join('\n')}` : ''}` },
          { role: 'user', content: segment.translationSource },
        ],
      }),
    })
    if (!response.ok) throw new Error(`AI 翻译服务返回 ${response.status}`)
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const translated = data.choices?.[0]?.message?.content?.trim()
    if (!translated) throw new Error('AI 没有返回译文。')
    return translated
  }

  async function translateAll() {
    const desktop = window.readerDesktop
    if (!desktop) { setNotice('中英对照需要在桌面客户端中运行。'); return }
    if (provider === 'local') {
      const status = await desktop.getLocalTranslationStatus({ from: 'en', to: 'zh' })
      if (!status.available) { setNotice(`${status.message} 请先安装本地翻译组件。`); return }
    } else if (!settings.allowFullDocument) {
      setNotice('AI 整篇对照翻译需要先在设置中允许发送派生文本；原 PDF 不会上传。')
      return
    }
    stopRef.current = false
    setBusy(true)
    setConfirmCloud(undefined)
    let working = retryFailedBilingualSegments(documentState.segments)
    try {
      while (!stopRef.current) {
        const batch = selectBilingualTranslationBatch(working, { retryFailed: true })
        if (!batch.length) break
        working = markBilingualBatchTranslating(working, batch)
        setDocumentState(current => ({ ...current, segments: working }))
        for (const segment of batch) {
          if (stopRef.current) break
          setNotice(`正在翻译第 ${segment.sourceIndex + 1} 个内容块；每次只处理一个小段。`)
          try {
            const translated = await translateSegment(segment)
            working = updateBilingualSegment(working, segment.id, { status: 'translated', translation: translated, provider, model: provider === 'ai' ? settings.model : 'Argos en_zh' })
            await persistSegment(working.find(item => item.id === segment.id)!, 'translated', translated)
          } catch (error) {
            const message = error instanceof Error ? error.message : '翻译失败'
            working = updateBilingualSegment(working, segment.id, { status: 'failed', error: message, provider, model: provider === 'ai' ? settings.model : 'Argos en_zh' })
            await persistSegment(working.find(item => item.id === segment.id)!, 'failed', undefined, message).catch(() => undefined)
          }
          setDocumentState(current => ({ ...current, segments: working }))
        }
      }
      const remaining = working.filter(segment => segment.translatable && ['pending', 'failed'].includes(segment.status)).length
      setNotice(stopRef.current ? `已暂停；还有 ${remaining} 段未完成。` : remaining ? `本轮结束；${remaining} 段翻译失败，可重试。` : '整篇可翻译段落已完成，并缓存在当前研究库。')
    } finally {
      setBusy(false)
    }
  }

  async function retryOneSegment(segmentId: string) {
    const desktop = window.readerDesktop
    const segment = documentState.segments.find(item => item.id === segmentId)
    if (!desktop || !segment) return
    if (segment.locked) { setNotice('这段译文已锁定；请先解锁再重试。'); return }
    if (provider === 'local') {
      const status = await desktop.getLocalTranslationStatus({ from: 'en', to: 'zh' })
      if (!status.available) { setNotice(`${status.message} 请先安装本地翻译组件。`); return }
    } else if (!settings.allowFullDocument || !settings.model || !settings.apiKey) {
      setNotice('云端翻译尚未获得发送许可或 Provider 配置不完整。')
      return
    }
    setSegmentBusy(segmentId)
    let working = updateBilingualSegment(documentState.segments, segmentId, { status: 'pending' })
    const pending = working.find(item => item.id === segmentId)!
    working = markBilingualBatchTranslating(working, [pending])
    setDocumentState(current => ({ ...current, segments: working }))
    const translating = working.find(item => item.id === segmentId)!
    try {
      const translated = await translateSegment(translating)
      working = updateBilingualSegment(working, segmentId, { status: 'translated', translation: translated, provider, model: provider === 'ai' ? settings.model : 'Argos en_zh' })
      await persistSegment(working.find(item => item.id === segmentId)!, 'translated', translated)
      setNotice(`已单独重试第 ${segment.sourceIndex + 1} 个内容块。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '翻译失败'
      working = updateBilingualSegment(working, segmentId, { status: 'failed', error: message, provider, model: provider === 'ai' ? settings.model : 'Argos en_zh' })
      await persistSegment(working.find(item => item.id === segmentId)!, 'failed', undefined, message).catch(() => undefined)
      setNotice(`单段重试失败：${message}`)
    } finally {
      setDocumentState(current => ({ ...current, segments: working }))
      setSegmentBusy(undefined)
      setConfirmCloud(undefined)
    }
  }

  async function saveSourceAdjustment() {
    if (!editingSegment?.text.trim()) return
    try {
      const segments = updateBilingualSegment(documentState.segments, editingSegment.id, { translationSource: editingSegment.text })
      const segment = segments.find(item => item.id === editingSegment.id)!
      setDocumentState(current => ({ ...current, segments }))
      await persistSegment(segment, 'pending')
      setEditingSegment(undefined)
      setNotice('已保存提取文本修正并生成新内容指纹；PDF 与 MinerU 原始 Markdown 未被修改。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提取文本修正保存失败。')
    }
  }

  async function toggleSegmentLock(segment: BilingualSegment) {
    try {
      const nextLocked = !segment.locked
      const segments = updateBilingualSegment(documentState.segments, segment.id, { locked: nextLocked, unlock: !nextLocked })
      const updated = segments.find(item => item.id === segment.id)!
      await persistSegment(updated, updated.status === 'translated' ? 'translated' : 'pending', updated.translation || undefined, undefined, !nextLocked)
      setDocumentState(current => ({ ...current, segments }))
      setNotice(nextLocked ? '译文已锁定；批量翻译、重试和引擎切换不会覆盖它。' : '译文已解锁，可以修改或重试。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '译文锁定状态保存失败。')
    }
  }

  async function saveTerm() {
    const desktop = window.readerDesktop as (Window['readerDesktop'] & TranslationCacheBridge) | undefined
    if (!desktop?.saveReadingTranslationTerm || !termDraft.sourceTerm.trim() || !termDraft.targetTerm.trim()) return
    try {
      setTerms(await desktop.saveReadingTranslationTerm({ sourceId, ...termDraft }))
      setTermDraft({ sourceTerm: '', targetTerm: '', note: '' })
      setNotice('术语已保存到当前文献的本地术语表。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '术语保存失败。')
    }
  }

  async function deleteTerm(termId: string) {
    const desktop = window.readerDesktop as (Window['readerDesktop'] & TranslationCacheBridge) | undefined
    if (!desktop?.deleteReadingTranslationTerm) return
    try { setTerms(await desktop.deleteReadingTranslationTerm({ sourceId, termId })) }
    catch (error) { setNotice(error instanceof Error ? error.message : '术语删除失败。') }
  }

  async function installTranslation() {
    const desktop = window.readerDesktop
    if (!desktop) { setNotice('请使用桌面客户端安装本地翻译组件。'); return }
    setInstalling(true)
    const taskId = crypto.randomUUID()
    const unsubscribe = desktop.onLocalTranslationProgress(progress => {
      if (progress.taskId === taskId) setNotice(progress.text)
    })
    try {
      const result = await desktop.installLocalTranslation({ taskId, from: 'en', to: 'zh' })
      setNotice(result.installed ? '本地英文 → 中文翻译组件已安装，可以开始整篇翻译。' : '本地翻译组件安装完成。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '本地翻译组件安装失败。')
    } finally {
      unsubscribe()
      setInstalling(false)
    }
  }

  if (!text) return <div className="reader-empty-state"><Languages size={28}/><strong>还没有可用于对照翻译的派生文本</strong><span>请先使用本地 MinerU 生成 Markdown；原 PDF 始终保留为引用依据。</span></div>

  let cloudProviderLabel = 'AI Provider'
  try { cloudProviderLabel = new URL(settings.baseUrl).host || cloudProviderLabel } catch { /* Settings UI owns URL validation. */ }
  const cloudTarget = confirmCloud?.segmentId ? documentState.segments.find(item => item.id === confirmCloud.segmentId) : undefined
  const cloudCharacters = cloudTarget?.translationSource.length || pendingCharacters
  const cloudSegments = cloudTarget ? 1 : documentState.segments.filter(segment => segment.translatable && !segment.locked && ['pending', 'failed'].includes(segment.status)).length

  return <article className="bilingual-reader">
    <header className="bilingual-reader-header">
      <div><span>英文原文 × 中文译文</span><strong>{title}</strong><small>译文是本地派生阅读层；修正文、译文和术语均不会覆盖 PDF 或原始 Markdown。</small></div>
      <div className="bilingual-progress" aria-label={`已翻译 ${translatedCount}，共 ${translatableCount} 段`}>
        <span><i style={{ width: `${translatableCount ? translatedCount / translatableCount * 100 : 0}%` }}/></span>
        <small>{translatedCount}/{translatableCount} 段{failedCount ? ` · ${failedCount} 段失败` : ''}</small>
      </div>
      <div className="bilingual-actions">
        <div className="bilingual-engine-switch" aria-label="翻译引擎">
          <button className={provider === 'local' ? 'active' : ''} disabled={busy || Boolean(segmentBusy)} onClick={() => setProvider('local')}><HardDrive/>本地 Argos</button>
          <button className={provider === 'ai' ? 'active' : ''} disabled={busy || Boolean(segmentBusy)} onClick={() => setProvider('ai')}><Cloud/>云端 AI</button>
        </div>
        {busy
          ? <button className="outline-button" onClick={() => { stopRef.current = true }}><Square size={13}/>暂停</button>
          : <button className="primary-button" disabled={!pendingCount || Boolean(segmentBusy)} onClick={() => provider === 'ai' ? setConfirmCloud({}) : void translateAll()}><Languages size={14}/>{translatedCount ? '继续翻译' : '开始翻译'}</button>}
        {failedCount > 0 && !busy && <button className="outline-button" onClick={() => { setDocumentState(current => ({ ...current, segments: retryFailedBilingualSegments(current.segments) })); setNotice('失败段落已进入重试队列。') }}><RotateCcw size={13}/>重试失败段</button>}
      </div>
    </header>
    {confirmCloud && <section className="bilingual-cloud-confirm">
      <WifiOff size={18}/><div><strong>确认发送这次翻译范围？</strong><p>范围：{cloudSegments} 段 / {cloudCharacters} 字符 · Provider：{cloudProviderLabel} · 模型：{settings.model || '未配置'}。只发送用于翻译的派生文本；PDF、批注、其他段落和其他研究库内容不会上传。</p></div>
      <button onClick={() => setConfirmCloud(undefined)}>取消</button><button className="confirm" disabled={!settings.allowFullDocument || !settings.model || !settings.apiKey} onClick={() => cloudTarget ? void retryOneSegment(cloudTarget.id) : void translateAll()}>确认并发送</button>
    </section>}
    <div className="bilingual-status"><span>{notice}</span><div>
      <b className={`translation-location ${provider}`}>{provider === 'local' ? <><HardDrive/>本机处理 · 无 Token</> : <><Cloud/>云端发送 · {settings.model || '模型未配置'}</>}</b>
      {provider === 'local' && /安装/.test(notice) && <button disabled={installing} onClick={() => void installTranslation()}>{installing ? '安装中…' : '安装本地翻译'}</button>}
      {provider === 'ai' && (!settings.allowFullDocument || !settings.model) && <button onClick={onSettings}><Settings2 size={12}/>打开设置</button>}
    </div></div>
    <div className="bilingual-reading-tools">
      <div className="bilingual-view-switch" aria-label="原文译文显示方式">
        <button className={displayMode === 'parallel' ? 'active' : ''} onClick={() => setDisplayMode('parallel')}>中英对照</button>
        <button className={displayMode === 'source' ? 'active' : ''} onClick={() => setDisplayMode('source')}>只看原文</button>
        <button className={displayMode === 'translation' ? 'active' : ''} onClick={() => setDisplayMode('translation')}>只看译文</button>
      </div>
      <button className={`bilingual-glossary-toggle ${glossaryOpen ? 'active' : ''}`} onClick={() => setGlossaryOpen(value => !value)}><BookMarked/>术语表 {terms.length}</button>
    </div>
    {glossaryOpen && <section className="bilingual-glossary" aria-label="当前文献术语表">
      <header><div><BookMarked/><span><strong>当前文献术语表</strong><small>云端提示会优先使用；本地翻译时用于人工核对。</small></span></div><button onClick={() => setGlossaryOpen(false)}><X/></button></header>
      <div className="bilingual-term-form"><input value={termDraft.sourceTerm} onChange={event => setTermDraft({ ...termDraft, sourceTerm: event.target.value })} placeholder="英文术语"/><input value={termDraft.targetTerm} onChange={event => setTermDraft({ ...termDraft, targetTerm: event.target.value })} placeholder="固定中文译法"/><input value={termDraft.note} onChange={event => setTermDraft({ ...termDraft, note: event.target.value })} placeholder="备注（可选）"/><button disabled={!termDraft.sourceTerm.trim() || !termDraft.targetTerm.trim()} onClick={() => void saveTerm()}><Save/>保存</button></div>
      <div className="bilingual-term-list">{terms.length ? terms.map(term => <div key={term.id}><span><b>{term.sourceTerm}</b><i>→</i><strong>{term.targetTerm}</strong>{term.note && <small>{term.note}</small>}</span><button title="删除术语" onClick={() => void deleteTerm(term.id)}><Trash2/></button></div>) : <p>尚无术语。遇到必须统一的专业词时在这里固定译法。</p>}</div>
    </section>}
    <div className={`bilingual-column-labels mode-${displayMode}`}>{displayMode !== 'translation' && <span>EN · 权威原文</span>}{displayMode !== 'source' && <span>ZH · 辅助译文</span>}</div>
    <div className="bilingual-segments">
      {pairs.filter(pair => pair.kind !== 'whitespace').map(pair => pair.translatable ? <section className={`bilingual-segment ${pair.status} mode-${displayMode} ${pair.locked ? 'locked' : ''}`} key={pair.segmentId} data-bilingual-segment={pair.segmentId}>
        <div className="bilingual-segment-tools">
          <span>{pair.sourceWasAdjusted ? '已修正提取文本 · 新指纹' : pair.translationSource !== pair.sourceMarkdown ? '已智能合并段落' : '原始分段'}</span>
          {pair.provider && <small>{pair.provider === 'local' ? '本地' : '云端'}{pair.model ? ` · ${pair.model}` : ''}</small>}
          <button disabled={pair.locked || Boolean(segmentBusy)} onClick={() => setEditingSegment({ id: pair.segmentId, text: pair.translationSource })}><Pencil/>修正提取文本</button>
          {pair.status === 'failed' && <button disabled={Boolean(segmentBusy)} onClick={() => provider === 'ai' ? setConfirmCloud({ segmentId: pair.segmentId }) : void retryOneSegment(pair.segmentId)}><RotateCcw/>单独重试</button>}
          {pair.status === 'translated' && <button className={pair.locked ? 'active' : ''} disabled={Boolean(segmentBusy)} onClick={() => void toggleSegmentLock(documentState.segments.find(item => item.id === pair.segmentId)!)}>{pair.locked ? <Unlock/> : <Lock/>}{pair.locked ? '解锁译文' : '锁定译文'}</button>}
        </div>
        {editingSegment?.id === pair.segmentId && <div className="bilingual-source-editor"><strong>修正用于翻译的提取文本</strong><small>原 PDF 与原始 Markdown 不会改变；保存后旧译文缓存因内容指纹变化自动失效。</small><textarea autoFocus value={editingSegment.text} onChange={event => setEditingSegment({ ...editingSegment, text: event.target.value })}/><div><button onClick={() => setEditingSegment(undefined)}>取消</button><button className="confirm" onClick={() => void saveSourceAdjustment()}><Save/>保存修正</button></div></div>}
        {displayMode !== 'translation' && <div className="bilingual-source"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml components={components}>{pair.sourceMarkdown}</ReactMarkdown></div>}
        {displayMode !== 'source' && <div className="bilingual-translation">{pair.translatedMarkdown
          ? <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml components={components}>{pair.translatedMarkdown}</ReactMarkdown>
          : <p className="bilingual-placeholder">{pair.status === 'translating' || segmentBusy === pair.segmentId ? '正在翻译…' : pair.status === 'failed' ? pair.error || '翻译失败，可单独重试' : '等待翻译'}</p>}</div>}
      </section> : <section className={`bilingual-structural ${pair.kind}`} key={pair.segmentId}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml components={components}>{pair.sourceMarkdown}</ReactMarkdown>
      </section>)}
    </div>
  </article>
}

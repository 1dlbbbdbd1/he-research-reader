import { AlertTriangle, Check, ClipboardCopy, X } from 'lucide-react'
import { useDialogKeyboard } from '../../use-dialog-keyboard'

export type CitationFieldGap = { field: string; label: string }
export type CitationView = {
  standard: 'GB/T 7714—2015' | string
  styleId: string
  documentType: string
  text: string
  missingFields: CitationFieldGap[]
  incomplete: boolean
}

export type CitationItemView = {
  id: string
  title: string
  itemType: string
  authors: Array<{ family?: string; given?: string; literal?: string }>
  issued?: string
  accessed?: string
  containerTitle?: string
  publisher?: string
  publisherPlace?: string
  volume?: string
  issue?: string
  pages?: string
  identifiers: Record<string, string[]>
  citation: CitationView
}

export function CitationButton({ item, onCopy, compact = false }: {
  item: CitationItemView
  onCopy: (item: CitationItemView) => void
  compact?: boolean
}) {
  return <button
    type="button"
    className={compact ? 'citation-copy-button compact' : 'citation-copy-button'}
    onClick={() => onCopy(item)}
    title={`复制 ${item.citation.standard} 引用`}
  >
    <ClipboardCopy size={compact ? 13 : 15}/>
    {compact ? '复制引用' : `复制 ${item.citation.standard} 引用`}
  </button>
}

export function CitationImportPanel({ items, alreadyImported, onCopy, onReview, onClose }: {
  items: CitationItemView[]
  alreadyImported: boolean
  onCopy: (item: CitationItemView) => void
  onReview: (item: CitationItemView) => void
  onClose: () => void
}) {
  if (!items.length) return null
  return <section className="citation-import-panel" aria-label="题录导入结果">
    <header>
      <div>
        <p>题录导入结果</p>
        <strong>{alreadyImported ? '这批题录已在当前研究库中' : `已接收 ${items.length} 条题录`}</strong>
        <span>下面的引用都来自同一个 GB/T 7714—2015 格式化服务。</span>
      </div>
      <button type="button" onClick={onClose} aria-label="关闭导入结果"><X size={16}/></button>
    </header>
    <div className="citation-import-list">
      {items.map(item => <article key={item.id}>
        <div className="citation-import-text">
          {item.citation.incomplete ? <AlertTriangle size={16}/> : <Check size={16}/>}
          <span><strong>{item.title}</strong><p>{item.citation.text}</p></span>
        </div>
        <div>
          {item.citation.incomplete && <button type="button" className="citation-review-button" onClick={() => onReview(item)}>检查题录</button>}
          <CitationButton item={item} onCopy={onCopy} compact/>
        </div>
      </article>)}
    </div>
  </section>
}

export function CitationDialog({ item, reason, onClose }: {
  item: CitationItemView
  reason?: string
  onClose: () => void
}) {
  const dialogRef = useDialogKeyboard<HTMLElement>(onClose)
  const fields = [
    ['类型', item.itemType],
    ['作者', item.authors.map(author => author.literal || [author.family, author.given].filter(Boolean).join(', ')).filter(Boolean).join('；')],
    ['年份', item.issued],
    ['来源', item.containerTitle],
    ['出版者', item.publisher],
    ['出版地', item.publisherPlace],
    ['访问日期', item.accessed],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  return <div className="modal-backdrop" role="presentation">
    <section ref={dialogRef} className="citation-dialog" role="dialog" aria-modal="true" aria-labelledby="citation-dialog-title">
      <header>
        <div><p>GB/T 7714—2015</p><h2 id="citation-dialog-title">{reason ? '剪贴板写入失败' : '检查题录元数据'}</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭"><X size={18}/></button>
      </header>
      {reason && <div className="citation-dialog-warning"><AlertTriangle size={17}/><span>{reason}<br/>下方文本可直接选中并手动复制。</span></div>}
      {item.citation.missingFields.length > 0 && <div className="citation-missing-fields">
        <strong>当前缺少</strong>
        <span>{item.citation.missingFields.map(field => field.label).join('、')}</span>
        <p>已按现有确认字段降级生成，没有补造缺失信息。</p>
      </div>}
      <label>可复制引用<textarea readOnly value={item.citation.text} onFocus={event => event.currentTarget.select()}/></label>
      <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <footer><button type="button" className="primary-button" onClick={onClose}>完成检查</button></footer>
    </section>
  </div>
}

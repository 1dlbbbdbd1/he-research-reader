import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, FileText, RotateCcw } from 'lucide-react'

type Props = {
  children: ReactNode
  resetKey: string
  viewLabel: string
  returnLabel?: string
  onReturnToOriginal: () => void
}

type State = {
  error?: Error
}

export default class ReaderViewBoundary extends Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[reader-view:${this.props.viewLabel}]`, error, info.componentStack)
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: undefined })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <section className="reader-view-failure" role="alert">
      <AlertTriangle size={30}/>
      <strong>{this.props.viewLabel}没有成功打开</strong>
      <p>{error.message || '派生阅读内容渲染失败。PDF 原文和 MinerU 原始 Markdown 没有被修改。'}</p>
      <div>
        <button className="outline-button" onClick={() => this.setState({ error: undefined })}><RotateCcw size={14}/>重试当前视图</button>
        <button className="primary-button" onClick={this.props.onReturnToOriginal}><FileText size={14}/>{this.props.returnLabel || '返回 PDF 原文'}</button>
      </div>
    </section>
  }
}

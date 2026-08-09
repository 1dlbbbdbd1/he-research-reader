const MAX_CLIPBOARD_TEXT_LENGTH = 100_000

function writeClipboardText(clipboard, input = {}) {
  const text = typeof input.text === 'string' ? input.text : ''
  if (!text.trim()) throw new Error('没有可复制的引用文本。')
  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) throw new Error('复制内容过长，已停止写入剪贴板。')
  if (!clipboard || typeof clipboard.writeText !== 'function' || typeof clipboard.readText !== 'function') {
    throw new Error('系统剪贴板当前不可用。')
  }
  clipboard.writeText(text)
  if (clipboard.readText() !== text) throw new Error('系统剪贴板未确认写入；请从预览中手动复制。')
  return { written: true, characterCount: text.length }
}

module.exports = { MAX_CLIPBOARD_TEXT_LENGTH, writeClipboardText }

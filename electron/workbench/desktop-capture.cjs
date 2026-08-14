function applyRedactions(image, requestedRedactions, nativeImage) {
  const redactions = Array.isArray(requestedRedactions) ? requestedRedactions.slice(0, 20) : []
  if (redactions.length === 0) return { image, redactionCount: 0 }
  const { width, height } = image.getSize()
  if (width < 1 || height < 1) throw new Error('授权窗口当前没有可捕获画面。')
  const bitmap = image.toBitmap()
  for (const redaction of redactions) {
    const x = Math.max(0, Math.min(width - 1, Math.round(Number(redaction?.x) || 0)))
    const y = Math.max(0, Math.min(height - 1, Math.round(Number(redaction?.y) || 0)))
    const maskWidth = Math.max(1, Math.min(width - x, Math.round(Number(redaction?.width) || 1)))
    const maskHeight = Math.max(1, Math.min(height - y, Math.round(Number(redaction?.height) || 1)))
    for (let row = y; row < y + maskHeight; row += 1) {
      for (let column = x; column < x + maskWidth; column += 1) {
        const offset = (row * width + column) * 4
        bitmap[offset] = 24
        bitmap[offset + 1] = 18
        bitmap[offset + 2] = 18
        bitmap[offset + 3] = 255
      }
    }
  }
  return { image: nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }), redactionCount: redactions.length }
}

module.exports = { applyRedactions }

export const READER_ZOOM_MIN = 0.5
export const READER_ZOOM_MAX = 3
export const READER_ZOOM_STEP = 0.1

export function clampReaderZoom(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.min(READER_ZOOM_MAX, Math.max(READER_ZOOM_MIN, Number(numeric.toFixed(2))))
}

export function readerZoomAfterWheel(current, deltaY, ctrlKey) {
  if (!ctrlKey || !Number.isFinite(deltaY) || deltaY === 0) return clampReaderZoom(current)
  return clampReaderZoom(current + (deltaY < 0 ? READER_ZOOM_STEP : -READER_ZOOM_STEP))
}

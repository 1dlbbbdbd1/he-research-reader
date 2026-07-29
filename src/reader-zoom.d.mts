export const READER_ZOOM_MIN: number
export const READER_ZOOM_MAX: number
export const READER_ZOOM_STEP: number
export function clampReaderZoom(value: number): number
export function readerZoomAfterWheel(current: number, deltaY: number, ctrlKey: boolean): number

import { useEffect, useRef } from 'react'

const focusableSelector = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogKeyboard<T extends HTMLElement>(onClose: () => void, active = true) {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  const wasActiveRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  closeRef.current = onClose
  if (active && !wasActiveRef.current) {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  wasActiveRef.current = active

  useEffect(() => {
    if (!active) return
    const dialog = ref.current
    if (!dialog) return
    const activeDialog = dialog
    const initial = dialog.querySelector<HTMLElement>('[autofocus]')
      || dialog.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      || dialog.querySelector<HTMLElement>(focusableSelector)
    window.requestAnimationFrame(() => initial?.focus())

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...activeDialog.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter(element => element.getClientRects().length > 0)
      if (!focusable.length) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [active])

  return ref
}

'use client'
import { useEffect } from 'react'

const COMPOSER = '.aui-composer-input'
const TYPING = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])'
const DIALOG = '[role="dialog"], [role="alertdialog"]'

const ignored = (event: KeyboardEvent): boolean =>
  event.defaultPrevented ||
  event.ctrlKey ||
  event.metaKey ||
  event.altKey ||
  (event.target instanceof Element && event.target.closest(TYPING) !== null) ||
  document.querySelector(DIALOG) !== null

export function useInboxKeys(move: (step: 1 | -1) => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignored(event)) return
      if (event.key === '/') {
        event.preventDefault()
        document.querySelector<HTMLTextAreaElement>(COMPOSER)?.focus()
      }
      if (event.key === 'j' || event.key === 'k') move(event.key === 'j' ? 1 : -1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [move])
}

const newest = (): HTMLElement | null => {
  const last = document.querySelector('[data-slot="aui_message-group"]')?.lastElementChild
  return last instanceof HTMLElement ? last : null
}

export function useScrollToNewest(thread: string, count: number) {
  useEffect(() => {
    const scroll = () => {
      const last = newest()
      if (!last) return
      last.style.scrollMarginBottom = '16rem'
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      last.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' })
    }
    const timers = [120, 500].map((delay) => setTimeout(scroll, delay))
    return () => timers.forEach(clearTimeout)
  }, [thread, count])
}

import { useEffect, useRef } from 'react'

export function usePinnedScroll(isPreview: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isPreview) {
      return undefined
    }
    const scrollEl = scrollRef.current
    const contentEl = contentRef.current
    if (!scrollEl || !contentEl) {
      return undefined
    }
    let pinned = true
    let lastScrollTop = scrollEl.scrollTop
    let lastScrollHeight = scrollEl.scrollHeight
    const isAtBottom = () =>
      Math.abs(scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) <= 1 ||
      scrollEl.scrollHeight <= scrollEl.clientHeight
    const pin = () => {
      if (!pinned) return
      scrollEl.scrollTop = scrollEl.scrollHeight
    }
    const onScroll = () => {
      if (isAtBottom()) {
        pinned = true
      } else if (scrollEl.scrollTop < lastScrollTop && scrollEl.scrollHeight === lastScrollHeight) {
        pinned = false
      }
      lastScrollTop = scrollEl.scrollTop
      lastScrollHeight = scrollEl.scrollHeight
    }
    pin()
    scrollEl.addEventListener('scroll', onScroll)
    const observer = new ResizeObserver(pin)
    observer.observe(contentEl)
    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [isPreview])
  return { scrollRef, contentRef }
}

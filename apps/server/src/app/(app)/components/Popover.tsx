'use client'
import { useEffect, useRef, type ReactNode } from 'react'

/** `<details>` popover that closes on outside click, Escape and on selecting an item. */
export function Popover({ label, children, align = 'end' }: { label: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current
      if (d && (e instanceof KeyboardEvent ? e.key === 'Escape' : !d.contains(e.target as Node))) d.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])
  return (
    <details ref={ref} className="pop">
      <summary className="btn">{label}</summary>
      <div className="menu" data-align={align} onClick={(e) => (e.target as HTMLElement).closest('a,button') && ref.current?.removeAttribute('open')}>
        {children}
      </div>
    </details>
  )
}

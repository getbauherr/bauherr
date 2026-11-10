'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const GIVE_UP_MS = 10_000

/** Thin bar at the top of the shell: active from the click on an internal link until the URL changed (also when the clicked link unmounts, like the avatar menu's). `app.css` styles `#nav-progress`. */
export function NavProgress() {
  const [active, setActive] = useState(false)
  const path = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => setActive(false), [path, search])
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.origin !== location.origin || a.hasAttribute('download')) return
      if (a.pathname + a.search !== location.pathname + location.search) setActive(true)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  useEffect(() => {
    if (!active) return
    const id = setTimeout(() => setActive(false), GIVE_UP_MS)
    return () => clearTimeout(id)
  }, [active])
  return <div id="nav-progress" data-testid="nav-progress" data-active={active} aria-hidden />
}

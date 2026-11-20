'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const GIVE_UP_MS = 10_000

const leavesPage = (e: MouseEvent, a: HTMLAnchorElement | null): a is HTMLAnchorElement =>
  !(
    !a ||
    e.defaultPrevented ||
    e.button ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    a.target ||
    a.origin !== location.origin ||
    a.hasAttribute('download')
  ) && a.pathname + a.search !== location.pathname + location.search

export function NavProgress() {
  const [active, setActive] = useState(false)
  const path = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => setActive(false), [path, search])
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href]') ?? null
      if (leavesPage(e, a)) setActive(true)
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

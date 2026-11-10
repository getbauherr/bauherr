'use client'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'
import { isOpen, readSaved, save, setOpen, subscribe, setStorageKey } from './dock-state'

const Panel = dynamic(() => import('./ChatPanel'), { ssr: false })

const MIN = 320
const MAX = 640
const clamp = (w: number) => Math.min(MAX, Math.max(MIN, Math.round(w)))

/** The dock column. The heavy part (assistant-ui, markdown) loads on first open and stays mounted afterwards, so a running answer survives closing and navigation. Open state is `html[data-chat]`, shown by CSS. */
export function ChatDockClient({ userId }: { userId: number | string }) {
  const key = `bauherr-chat:${userId}`
  setStorageKey(key)
  const open = useSyncExternalStore(subscribe, isOpen, () => false)
  const [loaded, setLoaded] = useState(false)
  const width = useRef(400)
  useEffect(() => {
    width.current = readSaved().w ?? 400
  }, [])
  useEffect(() => {
    if (open) setLoaded(true)
  }, [open])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setOpen(!isOpen())
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const resize = (w: number, persist: boolean) => {
    width.current = clamp(w)
    document.documentElement.style.setProperty('--chat-w', `${width.current}px`)
    if (persist) save({ w: width.current })
  }
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const move = (m: globalThis.PointerEvent) => resize(innerWidth - m.clientX, false)
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      resize(width.current, true)
    }
    e.preventDefault()
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      resize(width.current + (e.key === 'ArrowLeft' ? 24 : -24), true)
    }
  }

  return (
    <>
      <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40 hidden bg-foreground/40 [html[data-chat=open]_&]:block lg:[html[data-chat=open]_&]:hidden" />
      <aside
        id="chat-dock"
        data-testid="chat-dock"
        aria-label="Factory chat"
        className="aui-root fixed inset-y-0 right-0 z-50 hidden w-full flex-col border-l border-border bg-background text-foreground sm:w-[min(100vw,440px)] lg:sticky lg:top-0 lg:z-auto lg:h-svh lg:w-(--chat-w,400px) lg:shrink-0 [html[data-chat=open]_&]:flex"
      >
        <div role="separator" aria-orientation="vertical" aria-label="Resize chat" aria-valuemin={MIN} aria-valuemax={MAX} tabIndex={0} onPointerDown={drag} onKeyDown={nudge} className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none max-lg:hidden hover:bg-primary/30 focus-visible:bg-primary/30" />
        {loaded && <Panel userKey={`${key}:thread`} onClose={() => setOpen(false)} />}
      </aside>
    </>
  )
}

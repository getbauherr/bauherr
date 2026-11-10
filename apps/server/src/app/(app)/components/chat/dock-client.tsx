'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Chat } from './icons'
import { remember } from './api'

const Panel = dynamic(() => import('./ChatPanel'), { ssr: false })

const MIN = 320
const MAX = 640
const clamp = (w: number) => Math.min(MAX, Math.max(MIN, Math.round(w)))

type Saved = { open?: boolean; w?: number }
const read = (key: string): Saved => {
  try {
    return JSON.parse(remember.get(key) ?? '{}') as Saved
  } catch {
    return {}
  }
}

/** The factory chat, docked on the right of every page. The heavy part (assistant-ui, markdown, highlighter) loads on first open and stays mounted afterwards so a running answer survives closing and navigation. */
export function ChatDockClient({ userId }: { userId: number | string }) {
  const key = `bauherr-chat:${userId}`
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [mac, setMac] = useState(false)
  const width = useRef(400)

  const set = useCallback(
    (next: boolean) => {
      const root = document.documentElement
      if (next) root.dataset.chat = 'open'
      else delete root.dataset.chat
      setOpen(next)
      if (next) setLoaded(true)
      remember.set(key, JSON.stringify({ ...read(key), open: next }))
    },
    [key],
  )

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform))
    width.current = read(key).w ?? 400
    if (document.documentElement.dataset.chat === 'open') {
      setOpen(true)
      setLoaded(true)
    }
  }, [key])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        set(document.documentElement.dataset.chat !== 'open')
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [set])

  const resize = (w: number, save: boolean) => {
    width.current = clamp(w)
    document.documentElement.style.setProperty('--chat-w', `${width.current}px`)
    if (save) remember.set(key, JSON.stringify({ ...read(key), w: width.current }))
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
      <button
        type="button"
        data-testid="chat-open"
        aria-label="Ask the factory"
        aria-expanded={open}
        aria-controls="chat-dock"
        onClick={() => set(true)}
        title={`Ask the factory (${mac ? '⌘J' : 'Ctrl+J'})`}
        className="fixed right-4 bottom-4 z-30 inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 max-sm:size-10 max-sm:justify-center max-sm:px-0 text-[14px] font-medium text-card-foreground shadow-sm hover:bg-secondary max-sm:bottom-[calc(var(--next-step-h,0px)+var(--space-4))] [html[data-chat=open]_&]:hidden"
      >
        <Chat />
        <span className="max-sm:hidden">Ask the factory</span>
        <kbd className="font-mono text-xs text-muted-foreground max-sm:hidden">{mac ? '⌘J' : 'Ctrl+J'}</kbd>
      </button>
      <div aria-hidden onClick={() => set(false)} className="fixed inset-0 z-39 hidden bg-black/40 [html[data-chat=open]_&]:block lg:[html[data-chat=open]_&]:hidden" />
      <aside
        id="chat-dock"
        data-testid="chat-dock"
        aria-label="Factory chat"
        className="aui-root fixed inset-y-0 right-0 z-40 hidden w-full flex-col border-l border-border bg-background text-foreground sm:w-[min(100vw,440px)] lg:w-(--chat-w,400px) [html[data-chat=open]_&]:flex"
      >
        <div role="separator" aria-orientation="vertical" aria-label="Resize chat" aria-valuemin={MIN} aria-valuemax={MAX} tabIndex={0} onPointerDown={drag} onKeyDown={nudge} className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none max-lg:hidden hover:bg-primary/30 focus-visible:bg-primary/30" />
        {loaded && <Panel userKey={`${key}:thread`} onClose={() => set(false)} />}
      </aside>
    </>
  )
}

'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState, type FC } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from './api'

export type PageContext = { path: string; label: string; markdown: string }

/** What the page behind the dock is, refetched on every client-side navigation; `pinned`: the page a Ticket thread is about, wherever the dock sits. */
export function usePageContext(pinned?: string): PageContext | null {
  const pathname = usePathname()
  const query = useSearchParams().toString()
  const path = pinned ?? pathname + (query ? `?${query}` : '')
  const [info, setInfo] = useState<PageContext | null>(null)
  useEffect(() => {
    let live = true
    api.context(path).then((c) => live && setInfo({ path, ...c })).catch(() => live && setInfo(null))
    return () => {
      live = false
    }
  }, [path])
  return info
}

/** The context the model gets, one click away. */
export const ContextChip: FC<{ info: PageContext | null }> = ({ info }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" data-testid="context-chip" disabled={!info} className="max-w-full self-start truncate rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" title="What the assistant sees on this page">
        {info ? info.label : '...'}
      </button>
    </PopoverTrigger>
    <PopoverContent data-testid="context-markdown" className="max-h-[50dvh] w-[min(26rem,calc(100vw-2rem))] overflow-auto">
      <p className="mb-2 text-xs text-muted-foreground">This is what the assistant knows about the page.</p>
      <pre className="font-mono text-xs whitespace-pre-wrap">{info?.markdown}</pre>
    </PopoverContent>
  </Popover>
)

/** A reopened chat that was about another page. */
export const WasAbout: FC<{ was: { path: string; label: string } | null; now: string | undefined }> = ({ was, now }) =>
  was && now && was.path !== now ? (
    <p data-testid="chat-was-about" className="text-xs text-muted-foreground">
      This chat was about <Link href={was.path} className="text-primary underline underline-offset-2">{was.label}</Link>
    </p>
  ) : null

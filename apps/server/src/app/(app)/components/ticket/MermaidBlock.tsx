'use client'
import { useEffect, useId, useState } from 'react'

const systemTheme = (): string =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

const isDark = (): boolean => (document.documentElement.dataset.theme ?? systemTheme()) === 'dark'

export function MermaidBlock({ source }: { source: string }) {
  const id = `m${useId().replace(/[^a-z0-9]/gi, '')}`
  const [drawn, setDrawn] = useState<{ svg: string } | 'failed' | null>(null)
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(isDark())
    const watcher = new MutationObserver(() => setDark(isDark()))
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => watcher.disconnect()
  }, [])
  useEffect(() => {
    let live = true
    const draw = async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
        const { svg } = await mermaid.render(id, source)
        if (live) setDrawn({ svg })
      } catch {
        document.getElementById(`d${id}`)?.remove()
        if (live) setDrawn('failed')
      }
    }
    void draw()
    return () => {
      live = false
    }
  }, [source, dark, id])
  if (drawn === 'failed') {
    return (
      <div className="grid min-w-0 gap-1">
        <p className="small m-0 text-muted-foreground">This diagram could not be drawn, so its source is shown.</p>
        <pre className="mono m-0 min-w-0 overflow-x-auto rounded-md bg-secondary p-3">{source}</pre>
      </div>
    )
  }
  if (drawn === null) return <p className="small m-0 text-muted-foreground">Drawing the diagram.</p>
  return (
    <div
      role="img"
      aria-label="Flow diagram"
      className="min-w-0 overflow-x-auto rounded-md border border-border bg-card p-3"
      dangerouslySetInnerHTML={{ __html: drawn.svg }}
    />
  )
}

'use client'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'

export function SplitPane({ rootRef, cols, style, before, after, testId, collapsed, children }: { rootRef?: RefObject<HTMLDivElement | null>; cols: string; style?: CSSProperties; before?: ReactNode; after?: ReactNode; testId: string; collapsed?: boolean; children: ReactNode }) {
  const own = useRef<HTMLDivElement>(null)
  const root = rootRef ?? own
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWide(e!.contentRect.width >= 960))
    ro.observe(el)
    return () => ro.disconnect()
  }, [root])
  return (
    <div ref={root} className="group/split" data-testid={testId} data-wide={wide} data-collapsed={collapsed}>
      {before}
      <div className={`grid items-start gap-0 ${cols}`} style={style}>{children}</div>
      {after}
    </div>
  )
}

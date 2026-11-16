'use client'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'

/**
 * The split frame of the Ticket page and the Inbox: at container width of 960px and up the children sit in one grid (`cols` sets its columns), below that a child
 * shows or hides itself with `group-data-[wide=false]/split:`. The width comes from a ResizeObserver, not `container-type`, which would contain a fixed ActionBar to this box.
 * `before` and `after` render outside the grid.
 */
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

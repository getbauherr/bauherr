import { exactTime } from '../lib/run-view'
import { ago } from '../lib/format'

/** Relative time with the exact time in `title` (DESIGN.md Time display). */
export function Time({ iso, className, now }: { iso: string; className?: string; now?: number }) {
  return <time dateTime={iso} title={exactTime(iso)} className={className}>{ago(iso, now)}</time>
}

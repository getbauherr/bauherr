import { ago, exactTime } from '../lib/format'

export function Time({ iso, className }: { iso: string; className?: string }) {
  return <time dateTime={iso} title={exactTime(iso)} className={className}>{ago(iso)}</time>
}

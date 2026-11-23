import Link from 'next/link'
import type { ReactNode } from 'react'
import type { CheckState } from '../../../../core/memory-check'
import { Badge } from '../ui/badge'

type Issue = Exclude<CheckState, { kind: 'none' } | { kind: 'wants' }>

export function IssueRef({ check }: { check: Issue }) {
  const text = `#${check.issue}`
  if (check.record === null) return <span className="mono">{text}</span>
  return (
    <Link href={`/tickets/${check.record}`} className="mono hover:underline">
      {text}
    </Link>
  )
}

export const isShown = (check: CheckState): boolean =>
  check.kind === 'wants' || check.kind === 'building' || check.kind === 'since'

export function MemoryState({ off, check }: { off: boolean; check: CheckState }): ReactNode {
  if (off) return <Badge>Off</Badge>
  return isShown(check) ? <CheckBadge check={check} /> : <Badge variant="ok">Active</Badge>
}

export function CheckBadge({ check }: { check: CheckState }): ReactNode {
  switch (check.kind) {
    case 'wants':
      return <Badge variant="warn">Wants a check</Badge>
    case 'building':
      return (
        <>
          <Badge variant="accent">Check being built</Badge> <IssueRef check={check} />
        </>
      )
    case 'since':
      return (
        <Badge variant="ok">
          ✓ Check since <IssueRef check={check} />
        </Badge>
      )
    default:
      return null
  }
}

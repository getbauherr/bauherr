import type { ReactNode } from 'react'
import Link from 'next/link'
import type { RunLink } from '../../lib/run-view'
import { ExternalLink } from '../icons'
import { Panel } from './Panel'

export function RunLinks({ links, className, children }: { links: RunLink[]; className?: string; children?: ReactNode }) {
  return (
    <Panel id="run-links" title="Links" className={className}>
      <ul className="small m-0 flex list-none flex-col gap-1 p-0 max-sm:[&_a]:min-h-11">
        {links.map((l) => (
          <li key={l.href}>
            {l.external ? (
              <a className="inline-flex min-h-6 items-center gap-1 text-primary" href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label}<ExternalLink className="size-3" /><span className="sr-only"> (opens in new tab)</span>
              </a>
            ) : <Link className="inline-flex min-h-6 items-center text-primary" href={l.href}>{l.label}</Link>}
          </li>
        ))}
      </ul>
      {children}
    </Panel>
  )
}

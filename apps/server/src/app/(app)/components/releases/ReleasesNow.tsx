import type { ReleasesView } from '../../../../core/releases/view'
import { shortDate } from '../../lib/format'

const CHECKS = {
  passing: 'checks green',
  failing: 'checks failing',
  running: 'checks running',
  none: 'no checks reported',
} as const

const LINK = 'text-primary underline underline-offset-2'

export function ReleasesNow({ view }: { view: ReleasesView }) {
  const { production, staging } = view
  return (
    <dl className="m-0 flex flex-wrap gap-x-8 gap-y-4">
      <div className="grid gap-0.5">
        <dd className="order-1 m-0 mono text-2xl font-semibold leading-[30px]">
          {production ? (production.tag ?? production.sha.slice(0, 7)) : 'Nothing yet'}
        </dd>
        <dt className="small order-2 text-muted-foreground">
          {production
            ? `on production${production.at ? ` since ${shortDate(production.at)}` : ''}`
            : 'on production: no deployment reported'}
          {production?.url && (
            <>
              {' · '}
              <a href={production.url} className={LINK}>on the forge</a>
            </>
          )}
        </dt>
      </div>
      <div className="grid gap-0.5">
        <dd className="order-1 m-0 mono text-2xl font-semibold leading-[30px]">
          {staging ? staging.sha.slice(0, 7) : 'Nothing yet'}
        </dd>
        <dt className="small order-2 text-muted-foreground">
          {staging ? `on staging · ${CHECKS[staging.checks]}` : 'on staging: no deployment reported'}
        </dt>
      </div>
    </dl>
  )
}

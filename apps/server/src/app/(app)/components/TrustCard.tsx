import { cn } from '@/lib/utils'
import type { Grade, TicketTrust } from '../../../lib/trust'
import { usd } from '../lib/format'
import { Check, Minus, X } from './icons'
import { Card } from './ui/card'

export const GRADE_TONE: Record<Grade, string> = { A: 'text-ok', B: 'text-ok', C: 'text-warn', D: 'text-destructive' }
const MARK = { true: Check, false: X, null: Minus } as const
const TONE = { true: 'text-ok', false: 'text-destructive', null: 'text-muted-foreground' } as const
const WORD = { true: 'passed', false: 'failed', null: 'not applicable or unknown' } as const

const Mark = ({ pass }: { pass: boolean | null }) => {
  const Icon = MARK[`${pass}`]
  return <span className={cn('mr-1 inline-flex size-4 shrink-0 items-center', TONE[`${pass}`])} role="img" aria-label={WORD[`${pass}`]}><Icon className="size-4" /></span>
}

export function TrustCard({ trust, cost }: { trust: TicketTrust; cost: boolean }) {
  const { vsMedian, usd: total, estimated } = trust.cost
  return (
    <Card asChild className="gap-0 p-4">
      <section aria-label="Trust" data-testid="ticket-trust">
        <h2 className="label m-0 mb-2 text-muted-foreground">Trust</h2>
        <p className={cn('m-0 text-[40px] leading-10 font-semibold', GRADE_TONE[trust.grade])} data-testid="trust-grade" aria-label={`Grade ${trust.grade}`}>{trust.grade}</p>
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
          {trust.groups.map((g) => (
            <li key={g.id} data-testid="trust-group" data-group={g.id}>
              <details>
                <summary className="small flex cursor-pointer items-center"><Mark pass={g.pass} />{g.label}</summary>
                <ul className="small m-0 mt-1 flex list-none flex-col gap-1 p-0 pl-4 text-muted-foreground">
                  {g.lines.map((l) => <li key={l.text} className="flex"><Mark pass={l.pass} /><span>{l.text}</span></li>)}
                </ul>
              </details>
            </li>
          ))}
        </ul>
        {cost && (
          <p className="small m-0 mt-3 border-t border-border pt-2 text-muted-foreground" data-testid="trust-cost">
            <span className="mono text-foreground">{usd(total)}</span>{vsMedian != null && ` (${vsMedian.toFixed(1)}× median)`}{estimated && ' estimated'}
            {trust.cost.unreported > 0 && ` · ${trust.cost.unreported} session ${trust.cost.unreported === 1 ? 'Run' : 'Runs'} without usage`}
          </p>
        )}
      </section>
    </Card>
  )
}

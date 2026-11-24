import Link from 'next/link'
import type { Opening } from '../../../../core/retro/schema'
import { Chart } from '../assistant-ui/elements/chart'
import { DataTable } from '../assistant-ui/elements/data-table'
import { Badge } from '../ui/badge'
import { FIGURE_LABEL, deltaText, figureText } from '../../lib/retro'

export function RetroOpening({ opening }: { opening: Opening }) {
  const { counts } = opening
  return (
    <div className="grid gap-4">
      <p className="m-0">
        Analysed {counts.accepted} tickets and {counts.runs} runs. These are the figures of this range, with the change
        against the range before. {opening.figures.filter((figure) => figure.farOff).length} are far off, in red.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {opening.figures.map((figure) => (
          <Chart
            key={figure.key}
            label={FIGURE_LABEL[figure.key] ?? figure.key}
            value={figureText(figure.key, figure.value)}
            delta={deltaText(figure.key, figure.value, figure.previous)}
            values={figure.history}
            off={figure.farOff}
          />
        ))}
      </div>
      {opening.tickets.length > 0 && (
        <>
          <h2 className="m-0 text-base font-semibold">Tickets far off the others</h2>
          <DataTable
            caption="Tickets far off the others"
            columns={['Ticket', 'Verify rounds', 'Send-backs', 'Failed runs', 'What is off']}
            rows={opening.tickets.map((ticket) => ({
              key: String(ticket.recordId),
              cells: [
                <Link key="t" href={`/tickets/${ticket.recordId}`} className="text-primary hover:underline">
                  {ticket.title}
                </Link>,
                ticket.verifyRounds,
                ticket.sendBacks,
                ticket.failedRuns,
                ticket.off.map((label) => <Badge key={label}>{label}</Badge>),
              ],
            }))}
          />
        </>
      )}
    </div>
  )
}

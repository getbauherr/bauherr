'use client'

import { makeAssistantToolUI } from '@assistant-ui/react'
import type { Opening } from '../../../../core/retro/schema'
import { FIGURE_LABEL, deltaText, figureText } from '../../lib/retro'
import { Chart } from '../assistant-ui/elements/chart'
import { DataTable, type DataTableColumn } from '../assistant-ui/elements/data-table'
import { withToolStates } from '../conversation/tool-ui'
import { FIGURES_TOOL, type FiguresArgs } from './retro-adapter'

const LOWER_IS_BETTER = new Set([
  'sendBacks',
  'verifyRoundsPerTicket',
  'failedRuns',
  'questions',
  'secondsToAccepted',
  'costUsd',
  'correctionsCameBack',
])

const COLUMNS: DataTableColumn[] = [
  { key: 'title', label: 'Ticket', format: { kind: 'link', hrefKey: 'href' } },
  { key: 'verifyRounds', label: 'Verify rounds', format: { kind: 'number' }, align: 'end' },
  { key: 'sendBacks', label: 'Send-backs', format: { kind: 'number' }, align: 'end' },
  { key: 'failedRuns', label: 'Failed runs', format: { kind: 'number' }, align: 'end' },
  { key: 'off', label: 'What is off', format: { kind: 'list' } },
]

type Figure = Opening['figures'][number]

const trendOf = (figure: Figure): 'up' | 'down' | 'flat' => {
  if (figure.value === null || figure.previous === null || figure.value === figure.previous) return 'flat'
  return figure.value > figure.previous ? 'up' : 'down'
}

const known = (history: (number | null)[]): number[] => history.flatMap((point) => (point === null ? [] : [point]))

export function Figures({ opening }: { opening: Opening }) {
  const far = opening.figures.filter((figure) => figure.farOff).length
  return (
    <div className="grid gap-4">
      <p className="m-0">
        Analysed {opening.counts.accepted} tickets and {opening.counts.runs} runs. These are the figures of this range,
        with the change against the range before. {far} are far off, marked in red.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {opening.figures.map((figure) => {
          const points = known(figure.history)
          const label = FIGURE_LABEL[figure.key] ?? figure.key
          return (
            <Chart
              key={figure.key}
              label={figure.farOff ? `${label} · far off` : label}
              value={figureText(figure.key, figure.value)}
              delta={deltaText(figure.key, figure.value, figure.previous) ?? undefined}
              trend={trendOf(figure)}
              upIsGood={!LOWER_IS_BETTER.has(figure.key)}
              points={points}
              visibleCount={points.length}
              variant="line"
              className={figure.farOff ? 'ring-1 ring-danger' : undefined}
            />
          )
        })}
      </div>
      {opening.tickets.length > 0 && (
        <DataTable
          caption="Tickets far off the others"
          columns={COLUMNS}
          rowKey="id"
          rows={opening.tickets.map((ticket) => ({
            id: ticket.recordId,
            title: ticket.title,
            href: `/tickets/${ticket.recordId}`,
            verifyRounds: ticket.verifyRounds,
            sendBacks: ticket.sendBacks,
            failedRuns: ticket.failedRuns,
            off: ticket.off,
          }))}
        />
      )}
    </div>
  )
}

export const RetroFiguresToolUI = makeAssistantToolUI<FiguresArgs, string>({
  toolName: FIGURES_TOOL,
  render: withToolStates((props) => <Figures opening={props.args.opening} />),
})

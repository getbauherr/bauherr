'use client'
import { useEffect, useState } from 'react'
import type { CheckView } from '../../../../core/views/ticket-parts'
import { duration, exactTime } from '../../lib/format'
import { ForgeLink } from './ForgeLink'

export const NO_CHECKS_AFTER_MS = 600_000
const TICK_MS = 15_000

type CheckState = 'waiting' | 'running' | 'passed' | 'failed'

const ROW = 'grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-0'

const PASSING = ['success', 'neutral', 'skipped']

const stateOf = (check: CheckView): CheckState => {
  if (check.status === 'completed') return PASSING.includes(check.conclusion ?? '') ? 'passed' : 'failed'
  return check.status === 'in_progress' ? 'running' : 'waiting'
}

const STATE_WORDS: Record<CheckState, { word: string; tone: string }> = {
  waiting: { word: 'Waiting', tone: 'text-muted-foreground' },
  running: { word: 'Running', tone: 'text-primary' },
  passed: { word: 'Passed', tone: 'text-ok' },
  failed: { word: 'Failed', tone: 'text-destructive' },
}

function CheckRow({ check }: { check: CheckView }) {
  const state = stateOf(check)
  const { word, tone } = STATE_WORDS[state]
  return (
    <li className={ROW}>
      <span className={tone}>{word}</span>
      <span>{check.name}</span>
      {check.url !== '' && state !== 'waiting' ? (
        <ForgeLink href={check.url} label="Log" />
      ) : (
        <span className="small text-muted-foreground">{state === 'waiting' ? 'not started' : ''}</span>
      )}
    </li>
  )
}

export type ChecksPanelProps = {
  checks: CheckView[]
  since: string
  now: number
  pull: { url: string; label: string } | null
}

export function ChecksPanel({ checks, since, now: initial, pull }: ChecksPanelProps) {
  const [now, setNow] = useState(initial)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  const waited = Math.max(0, now - +new Date(since))
  const silent = checks.length === 0 && waited >= NO_CHECKS_AFTER_MS
  return (
    <>
      <p className="m-0 text-muted-foreground">
        Waiting <span className="mono">{duration(waited / 1000)}</span>{' '}
        <time dateTime={since} title={exactTime(since)} className="small">
          (since {exactTime(since).slice(11)})
        </time>
      </p>
      {checks.length > 0 && (
        <ul className="m-0 list-none rounded-md border border-border p-0">
          {checks.map((check) => (
            <CheckRow key={check.name} check={check} />
          ))}
        </ul>
      )}
      {silent && (
        <p role="status" className="m-0 rounded-md border border-border bg-muted p-3">
          No checks have started on this pull request. GitHub does not start checks when the pull request conflicts
          with main or the workflow is turned off.
        </p>
      )}
      {pull && <ForgeLink href={pull.url} label={pull.label} />}
    </>
  )
}

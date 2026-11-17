'use client'
import { useEffect, useRef, useState } from 'react'
import type { RunHealth } from '../../../../lib/run-health'
import { StatusChip } from '../StatusChip'
import { Sentence } from './Sentence'

/**
 * Chip, stage and Run id, and the status sentence (left out when the action bar carries it). The sentence is not live; a separate sr-only region
 * is filled only when the derived state changes, so a poll that leaves the state alone announces nothing.
 */
export function RunStatusLine({ health, status, stage, runId, showSentence }: { health: RunHealth; status: string; stage: string; runId: number; showSentence: boolean }) {
  const first = useRef(health.state)
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    if (first.current !== health.state) {
      first.current = health.state
      setAnnounced(`${health.chip}. ${health.sentence.replaceAll('`', '')}`)
    }
  }, [health])
  return (
    <>
      <p className="body flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip status={status} label={health.chip} tone={health.tone} clock={health.state === 'waiting_ci' || health.state === 'waiting_review'} />
        <span className="text-muted-foreground">{stage}</span>
        <span className="mono">Run {runId}</span>
      </p>
      {showSentence && <p className="body m-0" data-testid="run-sentence"><Sentence text={health.sentence} /></p>}
      <span className="sr-only" role="status" aria-live="polite">{announced}</span>
    </>
  )
}

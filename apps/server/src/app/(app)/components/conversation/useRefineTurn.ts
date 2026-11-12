'use client'
import { useCallback, useRef, useState } from 'react'
import type { TurnEvent } from '../../../api/refine/[ticket]/turn/route'
import type { View } from '../../../../lib/refine/engine'

/** A turn in flight: what the person sent (null for the background re-check) and the reply as far as it has come. */
export type Turn = { user: string | null; reply: string }
export type TurnBody = { text: string } | { recheck: { point: string } }
export type TurnResult = { ok: true; view: View | null } | { ok: false; aborted: boolean; error: string }

/**
 * One streamed refine turn against `/api/refine/<ticket>/turn`: `turn` is set from the moment of sending until the validated state arrives (`onView`), so any layout can show the
 * message and the "is writing" state; `stop` aborts (nothing is stored). Layout-neutral: it knows nothing about the panel.
 */
export const useRefineTurn = (ticket: number, onView: (view: View | null) => void) => {
  const [turn, setTurn] = useState<Turn | null>(null)
  const abort = useRef<AbortController | null>(null)

  const run = useCallback(
    async (body: TurnBody, user: string | null): Promise<TurnResult> => {
      const ctl = (abort.current = new AbortController())
      setTurn({ user, reply: '' })
      try {
        const res = await fetch(`/api/refine/${ticket}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
        if (!res.ok || !res.body) return { ok: false, aborted: false, error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const rows = buf.split('\n')
          buf = rows.pop() ?? ''
          for (const row of rows) {
            if (!row.trim()) continue
            const ev = JSON.parse(row) as TurnEvent
            if (ev.type === 'reply') setTurn({ user, reply: ev.text })
            else if (ev.type === 'error') return { ok: false, aborted: false, error: ev.message }
            else {
              onView(ev.view)
              return { ok: true, view: ev.view }
            }
          }
        }
        return { ok: false, aborted: false, error: 'The answer was cut off. Try again.' }
      } catch (e) {
        return { ok: false, aborted: ctl.signal.aborted, error: ctl.signal.aborted ? '' : e instanceof Error ? e.message : 'The turn failed.' }
      } finally {
        if (abort.current === ctl) abort.current = null
        setTurn(null)
      }
    },
    [ticket, onView],
  )

  return { turn, run, stop: useCallback(() => abort.current?.abort(), []) }
}

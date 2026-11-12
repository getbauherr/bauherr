'use client'
import { useCallback, useRef, useState } from 'react'

/** A turn in flight: what the person sent (null for the background re-check) and the reply as far as it has come. */
export type Turn = { user: string | null; reply: string }
export type TurnBody = { text: string; images?: number[] } | { recheck: { point: string } }
/** What a turn route streams: the reply as far as written, then the whole state of the conversation (`V`), or the reason nothing changed. */
export type TurnEvent<V> = { type: 'reply'; text: string } | { type: 'done'; view: V | null } | { type: 'error'; message: string }
export type TurnResult<V> = { ok: true; view: V | null } | { ok: false; aborted: boolean; error: string }

/**
 * One streamed turn of a conversation against its turn route (`url`: `/api/refine/<ticket>/turn`, `/api/requests/<id>/turn`): `turn` is set from the moment of sending until the validated state arrives (`onView`), so any layout can show the
 * message and the "is writing" state; `stop` aborts (nothing is stored). Layout-neutral: it knows nothing about the panel.
 */
export const useTurn = <V>(url: string, onView: (view: V | null) => void) => {
  const [turn, setTurn] = useState<Turn | null>(null)
  const abort = useRef<AbortController | null>(null)

  const run = useCallback(
    async (body: TurnBody, user: string | null): Promise<TurnResult<V>> => {
      const ctl = (abort.current = new AbortController())
      setTurn({ user, reply: '' })
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
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
            const ev = JSON.parse(row) as TurnEvent<V>
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
    [url, onView],
  )

  return { turn, run, stop: useCallback(() => abort.current?.abort(), []) }
}

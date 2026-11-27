'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export type Staged = {
  key: string
  recordId: number
  number: number
  receipt: string
  input: Record<string, unknown>
}

type Deps = {
  run: (staged: Staged) => Promise<string | null>
  notify: (staged: Staged, undo: () => void) => void
  onError: (staged: Staged, message: string) => void
  onSettled: (staged: Staged, advance: boolean) => void
  delay: number
}

export type Pending = {
  staged: Record<string, Staged>
  stage: (staged: Staged) => void
  undo: (key: string) => void
  flush: () => void
}

export function usePendingDecisions(deps: Deps): Pending {
  const [staged, setStaged] = useState<Record<string, Staged>>({})
  const waiting = useRef(new Map<string, { staged: Staged; timer: ReturnType<typeof setTimeout> }>())
  const latest = useRef(deps)
  latest.current = deps

  const drop = useCallback((key: string) => {
    setStaged((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== key)))
  }, [])

  const commit = useCallback(
    async (key: string, advance: boolean) => {
      const entry = waiting.current.get(key)
      if (!entry) return
      clearTimeout(entry.timer)
      waiting.current.delete(key)
      const failure = await latest.current.run(entry.staged)
      if (failure === null) return latest.current.onSettled(entry.staged, advance)
      drop(key)
      latest.current.onError(entry.staged, failure)
    },
    [drop],
  )

  const undo = useCallback(
    (key: string) => {
      const entry = waiting.current.get(key)
      if (!entry) return
      clearTimeout(entry.timer)
      waiting.current.delete(key)
      drop(key)
    },
    [drop],
  )

  const stage = useCallback(
    (next: Staged) => {
      const timer = setTimeout(() => void commit(next.key, true), latest.current.delay)
      waiting.current.set(next.key, { staged: next, timer })
      setStaged((current) => ({ ...current, [next.key]: next }))
      latest.current.notify(next, () => undo(next.key))
    },
    [commit, undo],
  )

  const flush = useCallback(() => {
    for (const key of [...waiting.current.keys()]) void commit(key, false)
  }, [commit])

  useEffect(() => {
    const leave = () => flush()
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [flush])

  return { staged, stage, undo, flush }
}

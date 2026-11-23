import { useEffect, useRef, useState } from 'react'

export function useComment() {
  const area = useRef<HTMLTextAreaElement>(null)
  const [note, setNote] = useState('')
  const [opened, setOpened] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [focusTick, setFocusTick] = useState(0)

  useEffect(() => {
    if (focusTick > 0) area.current?.focus()
  }, [focusTick])

  const reveal = (prompt: string | null) => {
    setOpened(true)
    setHint(prompt)
    setFocusTick((tick) => tick + 1)
  }

  return {
    area,
    note,
    setNote,
    hint,
    missing,
    empty: note.trim() === '',
    open: opened || note !== '',
    reveal,
    demand: (message: string, prompt: string) => {
      setMissing(message)
      reveal(prompt)
    },
    settle: (prompt: string | null) => {
      setMissing(null)
      setHint(prompt)
    },
    reset: () => {
      setNote('')
      setOpened(false)
      setMissing(null)
    },
  }
}

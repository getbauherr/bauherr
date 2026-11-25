import { useAui, useAuiState } from '@assistant-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'

export function useComment() {
  const aui = useAui()
  const area = useRef<HTMLTextAreaElement>(null)
  const note = useAuiState((s) => s.composer.text)
  const attachments = useAuiState((s) => s.composer.attachments)
  const fileIds = useMemo(
    () => attachments.filter((a) => a.status.type === 'requires-action').map((a) => Number(a.id)),
    [attachments],
  )
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
    fileIds,
    hint,
    missing,
    empty: note.trim() === '',
    open: opened || note !== '' || fileIds.length > 0,
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
      void aui.composer().reset()
      setOpened(false)
      setMissing(null)
    },
  }
}

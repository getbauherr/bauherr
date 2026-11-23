'use client'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

const ROWS = '[data-inbox-row]'
const TYPING = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])'
const DIALOG = '[role="dialog"], [role="alertdialog"]'

const KEYS: [keys: string, does: string][] = [
  ['j or ArrowDown', 'Focus the next row'],
  ['k or ArrowUp', 'Focus the previous row'],
  ['o or Enter', 'Open the focused row'],
  ['Esc', 'Clear the focus'],
  ['?', 'Show these keys'],
]

const rowsOf = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(ROWS))

const rowAt = (key: string): HTMLElement | undefined => rowsOf().find((r) => r.dataset.inboxRow === key)

const ignored = (e: KeyboardEvent): boolean =>
  e.defaultPrevented ||
  e.ctrlKey ||
  e.metaKey ||
  e.altKey ||
  (e.target instanceof Element && e.target.closest(TYPING) !== null) ||
  document.querySelector(DIALOG) !== null

const useInboxKeys = (focused: RefObject<string | null>, setHelp: (open: boolean) => void) => {
  useEffect(() => {
    const move = (step: 1 | -1) => {
      const rows = rowsOf()
      const at = rows.findIndex((r) => r.dataset.inboxRow === focused.current)
      const next = rows[Math.min(Math.max(at + step, 0), rows.length - 1)]
      next?.focus()
    }
    const open = () => {
      if (focused.current !== null) rowAt(focused.current)?.click()
    }
    const clear = () => {
      if (focused.current === null) return
      rowAt(focused.current)?.blur()
      focused.current = null
    }
    const actions: Record<string, () => void> = {
      j: () => move(1),
      ArrowDown: () => move(1),
      k: () => move(-1),
      ArrowUp: () => move(-1),
      o: open,
      Escape: clear,
      '?': () => setHelp(true),
    }
    const onKey = (e: KeyboardEvent) => {
      const action = actions[e.key]
      if (!action || ignored(e)) return
      action()
      if (e.key !== 'Escape') e.preventDefault()
    }
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement) || e.target.closest(DIALOG)) return
      focused.current = e.target.dataset.inboxRow ?? null
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [focused, setHelp])
}

export function InboxKeys({ children }: { children: ReactNode }) {
  const [help, setHelp] = useState(false)
  const focused = useRef<string | null>(null)
  useInboxKeys(focused, setHelp)

  useEffect(() => {
    if (help || focused.current === null) return
    const row = rowAt(focused.current)
    if (row && document.activeElement !== row) row.focus()
  })

  return (
    <>
      {children}
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard keys</DialogTitle>
            <DialogDescription>Work through the Inbox without the mouse.</DialogDescription>
          </DialogHeader>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            {KEYS.map(([keys, does]) => (
              <div key={keys} className="contents">
                <dt className="mono">{keys}</dt>
                <dd className="m-0 text-muted-foreground">{does}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
}

'use client'
import { useState, type ReactNode } from 'react'

/** The full executor data of a step row, one click away (not a `<details>`: the Ticket page has exactly one). */
export function RowDetail({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <button type="button" aria-expanded={open} className="small w-fit cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>{open ? 'Hide executor' : 'Executor details'}</button>
      {open && children}
    </div>
  )
}

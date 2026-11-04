'use client'
import { useState, type ReactNode } from 'react'
import { Button } from './ui/button'

/** A toggle that shows `children` below it (not a `<details>`: the Ticket page has exactly one). */
export function Reveal({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <Button type="button" variant="outline" className="self-start" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</Button>
      {open && children}
    </section>
  )
}

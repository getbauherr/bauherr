import type { ReactNode } from 'react'

export const CARD = 'rounded-md border border-border bg-card'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="label text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

export function Facts({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[150px_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="m-0">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Card({ children, bare }: { children: ReactNode; bare?: boolean }) {
  return <div className={`${CARD} ${bare ? '' : 'grid gap-5 p-6'}`}>{children}</div>
}

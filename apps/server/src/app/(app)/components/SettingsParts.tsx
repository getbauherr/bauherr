import type { ReactNode } from 'react'
import type { Tone } from '../lib/product-setup'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Switch } from './ui/switch'

const badge = { ok: 'ok', warn: 'warn', muted: 'muted' } as const

export const StatusWord = ({ tone, children }: { tone: Tone; children: ReactNode }) => <Badge variant={badge[tone]}>{children}</Badge>

export function ToggleRow({ name, label, help, defaultChecked, disabled, reason }: { name?: string; label: string; help: string; defaultChecked?: boolean; disabled?: boolean; reason?: string }) {
  return (
    <label data-slot="toggle-row" className="flex items-start justify-between gap-4 border-t border-border py-3">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-foreground">{label}</span>
        <span className="small text-muted-foreground">{help}</span>
        {reason && <span className="small text-muted-foreground">{reason}</span>}
      </span>
      <span className="flex min-w-16 flex-none items-center justify-end gap-2">
        <Switch name={name} defaultChecked={defaultChecked} disabled={disabled} className="peer" />
        <span className="small text-muted-foreground peer-checked:hidden">Off</span>
        <span className="small hidden peer-checked:inline">On</span>
      </span>
    </label>
  )
}

export function RadioCards({ name, legend, value, disabled, options }: { name: string; legend: string; value: string; disabled?: boolean; options: { value: string; title: string; text: string }[] }) {
  return (
    <fieldset className="m-0 grid grid-cols-2 gap-3 border-0 p-0 max-sm:grid-cols-1" disabled={disabled}>
      <legend className="small col-span-full mb-2 p-0 font-medium text-foreground">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 has-checked:bg-accent has-checked:outline-2 has-checked:-outline-offset-1 has-checked:outline-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
          <input type="radio" name={name} value={o.value} defaultChecked={o.value === value} className="mt-1 accent-primary" />
          <span className="flex min-w-0 flex-col gap-1"><span className="font-medium text-foreground">{o.title}</span><span className="small text-muted-foreground">{o.text}</span></span>
        </label>
      ))}
    </fieldset>
  )
}

export function SettingsSection({ id, n, title, purpose, children, advanced }: { id: string; n?: number; title: string; purpose?: string; children: ReactNode; advanced?: ReactNode }) {
  return (
    <Card asChild className="scroll-mt-4 gap-4 p-4">
      <section id={id}>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="heading">{n && <span className="mono text-muted-foreground mr-2">{n}</span>}{title}</h2>
          {purpose && <p className="small text-muted-foreground">{purpose}</p>}
        </div>
        {children}
        {advanced && (
          <details data-slot="advanced">
            <summary className="small cursor-pointer text-primary">Advanced</summary>
            <div className="flex flex-col gap-4 mt-3">{advanced}</div>
          </details>
        )}
      </section>
    </Card>
  )
}

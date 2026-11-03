import type { ReactNode } from 'react'
import type { Tone } from '../lib/product-setup'
import { Badge } from './ui/badge'
import { Card } from './ui/card'

const badge = { ok: 'ok', warn: 'warn', muted: 'muted' } as const

/** Status word in its tone colour; the word carries the meaning, colour only supports it. */
export const StatusWord = ({ tone, children }: { tone: Tone; children: ReactNode }) => <Badge variant={badge[tone]}>{children}</Badge>

/** A switch with label and help; the On/Off word sits beside it. A disabled row can carry the reason. */
export function ToggleRow({ name, label, help, defaultChecked, disabled, reason }: { name?: string; label: string; help: string; defaultChecked?: boolean; disabled?: boolean; reason?: string }) {
  return (
    <label className="toggle-row">
      <span className="stack-1">
        <span className="label-strong">{label}</span>
        <span className="small muted">{help}</span>
        {reason && <span className="small muted">{reason}</span>}
      </span>
      <span className="toggle">
        <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} disabled={disabled} className="peer" />
        <span className="small muted peer-checked:hidden">Off</span>
        <span className="small hidden peer-checked:inline">On</span>
      </span>
    </label>
  )
}

/** Gate row without a control: name, help and the state word. */
export const GateRow = ({ label, help, state }: { label: string; help: string; state: string }) => (
  <div className="toggle-row">
    <span className="stack-1"><span className="label-strong">{label}</span><span className="small muted">{help}</span></span>
    <span className="small">{state}</span>
  </div>
)

/** Radio group as cards; the checked card gets an accent ring. */
export function RadioCards({ name, legend, value, disabled, options }: { name: string; legend: string; value: string; disabled?: boolean; options: { value: string; title: string; text: string }[] }) {
  return (
    <fieldset className="rcards" disabled={disabled}>
      <legend className="small label-strong">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="rcard">
          <input type="radio" name={name} value={o.value} defaultChecked={o.value === value} />
          <span className="stack-1"><span className="label-strong">{o.title}</span><span className="small muted">{o.text}</span></span>
        </label>
      ))}
    </fieldset>
  )
}

const callout = { ok: 'border-l-ok', warn: 'border-l-warn', muted: 'border-l-border' } as const
const word = { ok: 'text-ok', warn: 'text-warn', muted: 'text-muted-foreground' } as const

export const StatusCallout = ({ tone, lead, children }: { tone: Tone; lead: string; children: ReactNode }) => (
  <p role="status" className={`rounded-md border border-l-2 border-border bg-card p-3 ${callout[tone]}`}>
    <span className={`label mr-2 ${word[tone]}`}>{lead}</span>{children}
  </p>
)

/** Numbered section card with an anchor, a purpose line and an optional Advanced disclosure. */
export function SettingsSection({ id, n, title, purpose, children, advanced }: { id: string; n?: number; title: string; purpose?: string; children: ReactNode; advanced?: ReactNode }) {
  return (
    <Card asChild className="scroll-mt-4 gap-4 p-4">
      <section id={id}>
        <div className="stack-1">
          <h2 className="heading">{n && <span className="mono muted mr-2">{n}</span>}{title}</h2>
          {purpose && <p className="small muted">{purpose}</p>}
        </div>
        {children}
        {advanced && (
          <details className="advanced">
            <summary className="small">Advanced</summary>
            <div className="stack mt-3">{advanced}</div>
          </details>
        )}
      </section>
    </Card>
  )
}

export const SetupChecklist = ({ rows }: { rows: { id: string; label: string; word: string; tone: Tone }[] }) => (
  <Card asChild className="gap-0 p-0">
    <ul aria-label="Setup" className="list-none">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <a href={`#${r.id}`}>{r.label}</a>
          <StatusWord tone={r.tone}>{r.word}</StatusWord>
        </li>
      ))}
    </ul>
  </Card>
)

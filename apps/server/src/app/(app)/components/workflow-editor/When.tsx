'use client'
import { useState } from 'react'
import { asList, REQUEST_TYPES, SUGGESTED_SETS, type When } from '../../../../lib/workflow-when'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'
import { Commit } from './Fields'

const MANY = '__many__'
const clean = (w: When): When | undefined => {
  const out = Object.fromEntries(Object.entries(w).filter(([, v]) => (Array.isArray(v) ? v.length : !!v))) as When
  return Object.keys(out).length ? out : undefined
}

/**
 * "When does this step run?": always, or only when the change touches a path set of the Product, the request is of a type or the ticket has a label.
 * `declared` maps the path sets some Product of the Workspace declares to those Products; a chosen set nobody declares gets a hint.
 */
export function WhenFields({ value, onChange, declared, idPrefix }: { value: When | undefined; onChange: (w: When | undefined) => void; declared: Record<string, string[]>; idPrefix: string }) {
  const [only, setOnly] = useState(!!value && Object.keys(value).length > 0)
  const w = value ?? {}
  const touches = asList(w.touches)
  const names = [...new Set([...SUGGESTED_SETS, ...Object.keys(declared), ...touches])]
  const set = (patch: When) => onChange(clean({ ...w, ...patch }))
  const missing = touches.filter((n) => !declared[n]?.length)
  return (
    <div className="flex flex-col gap-3" data-testid="when">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-mode`} className="small">When does this step run?</Label>
        <NativeSelect id={`${idPrefix}-mode`} value={only ? 'only' : 'always'} onChange={(e) => (setOnly(e.target.value === 'only'), e.target.value === 'always' && onChange(undefined))}>
          <option value="always">Always</option>
          <option value="only">Only when…</option>
        </NativeSelect>
      </div>
      {only && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-touches`} className="small">The change touches</Label>
            <NativeSelect id={`${idPrefix}-touches`} value={touches.length > 1 ? MANY : (touches[0] ?? '')} onChange={(e) => set({ touches: e.target.value || undefined })}>
              <option value="">Any paths</option>
              {touches.length > 1 && <option value={MANY} disabled>Several sets (edit in the YAML)</option>}
              {names.map((n) => <option key={n} value={n}>{n} paths</option>)}
            </NativeSelect>
            {missing.length > 0 && <span className="small text-muted-foreground" data-testid="when-hint">No Product of this Workspace declares {missing.map((n) => `${n} paths`).join(' or ')} yet, so this step never runs. Declare them on the Product page, under Checks & merging.</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-types`} className="small">The request is</Label>
            <NativeSelect id={`${idPrefix}-types`} value={asList(w.types).length > 1 ? MANY : (asList(w.types)[0] ?? '')} onChange={(e) => set({ types: e.target.value ? [e.target.value] : undefined })}>
              <option value="">Any type</option>
              {asList(w.types).length > 1 && <option value={MANY} disabled>Several types (edit in the YAML)</option>}
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>a {t}</option>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-labels`} className="small">The ticket has the label</Label>
            <Commit id={`${idPrefix}-labels`} placeholder="Any label" aria-label="The ticket has the label" value={asList(w.labels).join(', ')} onCommit={(v) => set({ labels: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <span className="small text-muted-foreground">Several labels, separated by commas, match when the ticket has any of them.</span>
          </div>
          <span className="small text-muted-foreground">When the changed files are not known yet, the step runs.</span>
        </>
      )}
    </div>
  )
}

import type { ReactNode } from 'react'
import { AREA_NAMES } from '../../../../core/releases/notes-areas'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Textarea } from '../ui/textarea'

export type Draft = { id: string | null; kind: 'new' | 'fixed'; area: string; title: string | null; text: string }

type Props = {
  action: (form: FormData) => Promise<void>
  product: number
  draft: Draft
  submit: string
  children?: ReactNode
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="small grid gap-1">
      {label}
      {children}
    </label>
  )
}

function SectionField({ draft }: { draft: Draft }) {
  if (draft.id !== null) return null
  return (
    <Field label="Section">
      <NativeSelect name="kind" defaultValue={draft.kind}>
        <option value="new">New and improved</option>
        <option value="fixed">Fixed</option>
      </NativeSelect>
    </Field>
  )
}

function TitleField({ draft }: { draft: Draft }) {
  if (draft.kind === 'fixed') return null
  return (
    <Field label="Title (2 to 4 words)">
      <Input name="title" defaultValue={draft.title ?? ''} maxLength={60} />
    </Field>
  )
}

export function NoteForm({ action, product, draft, submit, children }: Props) {
  return (
    <form action={action} className="grid gap-2 rounded-md border border-border bg-card p-3">
      <Input type="hidden" name="product" value={product} />
      {draft.id !== null && <Input type="hidden" name="item" value={draft.id} />}
      <SectionField draft={draft} />
      <Field label="Area">
        <NativeSelect name="area" defaultValue={draft.area}>
          {AREA_NAMES.map((name) => <option key={name}>{name}</option>)}
        </NativeSelect>
      </Field>
      <TitleField draft={draft} />
      <Field label="One sentence of up to 20 words">
        <Textarea name="text" defaultValue={draft.text} maxLength={200} className="min-h-16" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm">{submit}</Button>
        {children}
      </div>
    </form>
  )
}

import type { Ref } from 'react'
import { Button } from '../ui/button'
import { NOTE_SCOPE_LABEL, NOTE_SCOPES, type NoteScope } from '../../../../core/statement-scope'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'
import { Textarea } from '../ui/textarea'

const FIELD_ID = 'decision-comment'
const HINT_ID = 'decision-comment-hint'
const ERROR_ID = 'decision-comment-error'
const SCOPE_ID = 'decision-scope'
const COUNT_FROM = 100

type Props = {
  value: string
  max: number
  hint: string | null
  missing: string | null
  areaRef: Ref<HTMLTextAreaElement>
  scope: NoteScope
  onChange: (value: string) => void
  onScope: (value: NoteScope) => void
}

export function CommentToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="px-6 pb-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-3 text-muted-foreground"
        aria-expanded={false}
        aria-controls={FIELD_ID}
        onClick={onOpen}
      >
        Add a comment
      </Button>
    </div>
  )
}

function CommentFoot({ missing, left }: { missing: string | null; left: number }) {
  if (!missing && left >= COUNT_FROM) return null
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      {missing ? <p id={ERROR_ID} role="alert" className="small m-0 text-destructive">{missing}</p> : <span />}
      {left < COUNT_FROM && <p className="small m-0 text-muted-foreground">{left} characters left</p>}
    </div>
  )
}

export function CommentField({ value, max, hint, missing, areaRef, scope, onChange, onScope }: Props) {
  const left = max - value.length
  const describedBy = [hint ? HINT_ID : null, missing ? ERROR_ID : null].filter((id) => id !== null).join(' ')
  return (
    <div className="grid gap-2 px-6 pb-6">
      <Label htmlFor={FIELD_ID}>Comment</Label>
      {hint && <p id={HINT_ID} className="small m-0 text-muted-foreground">{hint}</p>}
      <Textarea
        id={FIELD_ID}
        ref={areaRef}
        className="font-sans"
        value={value}
        maxLength={max}
        aria-invalid={missing ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <CommentFoot missing={missing} left={left} />
      <Label htmlFor={SCOPE_ID}>Applies to</Label>
      <NativeSelect
        id={SCOPE_ID}
        value={scope}
        onChange={(event) => onScope(NOTE_SCOPES.find((value) => value === event.target.value) ?? 'ticket')}
      >
        {NOTE_SCOPES.map((value) => (
          <option key={value} value={value}>
            {NOTE_SCOPE_LABEL[value]}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

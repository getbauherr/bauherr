import type { Ref } from 'react'
import { NOTE_SCOPE_LABEL, NOTE_SCOPES, type NoteScope } from '../../../../core/statement-scope'
import { Composer } from '../conversation/Composer'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'

const FIELD_ID = 'decision-comment'
const HINT_ID = 'decision-comment-hint'
const ERROR_ID = 'decision-comment-error'
const SCOPE_ID = 'decision-scope'
const COUNT_FROM = 100

type Props = {
  left: number
  max: number
  hint: string | null
  missing: string | null
  areaRef: Ref<HTMLTextAreaElement>
  scope: NoteScope
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

export function DecisionComment({ left, max, hint, missing, areaRef, scope, onScope }: Props) {
  const describedBy = [hint ? HINT_ID : null, missing ? ERROR_ID : null].filter((id) => id !== null).join(' ')
  return (
    <div className="grid gap-2 px-6 pb-6">
      <Label htmlFor={FIELD_ID}>Comment</Label>
      {hint && <p id={HINT_ID} className="small m-0 text-muted-foreground">{hint}</p>}
      <Composer
        placeholder="Write a comment"
        inputId={FIELD_ID}
        inputRef={areaRef}
        maxLength={max}
        sendable={false}
        describedBy={describedBy || undefined}
        invalid={Boolean(missing)}
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

import type { Ref } from 'react'
import { Composer } from '../assistant-ui/elements/thread-composer'
import { Button } from '../ui/button'
import { Label } from '../ui/label'

const FIELD_ID = 'decision-comment'
const HINT_ID = 'decision-comment-hint'
const ERROR_ID = 'decision-comment-error'
const COUNT_FROM = 100

type Props = {
  left: number
  max: number
  hint: string | null
  missing: string | null
  areaRef: Ref<HTMLTextAreaElement>
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

export function DecisionComment({ left, max, hint, missing, areaRef }: Props) {
  const describedBy = [hint ? HINT_ID : null, missing ? ERROR_ID : null].filter((id) => id !== null).join(' ')
  return (
    <div className="grid gap-2 px-6 pb-6">
      <Label htmlFor={FIELD_ID}>Comment</Label>
      {hint && <p id={HINT_ID} className="small m-0 text-muted-foreground">{hint}</p>}
      <Composer
        autoFocus={false}
        nested
        sendable={false}
        field={{
          id: FIELD_ID,
          ref: areaRef,
          placeholder: 'Write a comment',
          maxLength: max,
          'aria-describedby': describedBy || undefined,
          'aria-invalid': missing ? true : undefined,
        }}
      />
      <CommentFoot missing={missing} left={left} />
    </div>
  )
}

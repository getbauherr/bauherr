'use client'
import { CheckIcon } from 'lucide-react'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { cn } from '@/lib/utils'
import type { CriteriaModel, NoteSpec, OpenAnswer } from '../../lib/inbox-decision'

type PickerProps = { criteria: CriteriaModel; ticked: string[]; onChange: (next: string[]) => void }

export function CriteriaPicker({ criteria, ticked, onChange }: PickerProps) {
  const toggle = (id: string) => onChange(ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id])
  return (
    <fieldset className="m-0 grid gap-0.5 border-0 p-0">
      <legend className="sr-only">Criteria to drop</legend>
      {criteria.active.map(({ id, text }) => (
        <label key={id} className="small flex cursor-pointer items-center gap-2.5 rounded-md py-1.5">
          <Checkbox checked={ticked.includes(id)} onChange={() => toggle(id)} />
          <span className="mono text-muted-foreground">{id}</span>
          <span>{text}</span>
        </label>
      ))}
      {criteria.dropped.map(({ id, text }) => (
        <p key={id} className="small text-muted-foreground m-0 flex items-center gap-2.5 py-1.5">
          <CheckIcon className="size-4" aria-hidden />
          <span className="mono">{id}</span>
          <span>{text}</span>
          <span>Dropped by you</span>
        </p>
      ))}
    </fieldset>
  )
}

type AnswersProps = {
  answers: OpenAnswer[]
  chosen: Record<string, string>
  onChange: (id: string, to: string) => void
}

export function OpenAnswers({ answers, chosen, onChange }: AnswersProps) {
  return (
    <>
      {answers.map((answer) => (
        <fieldset key={answer.id} className="m-0 grid gap-1 border-0 p-0">
          <legend className="small mb-1 p-0 font-medium">{answer.question}</legend>
          {answer.options.map((option) => (
            <label
              key={option.id}
              className={cn(
                'small flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2',
                'has-checked:border-primary has-checked:bg-accent',
              )}
            >
              <Input
                type="radio"
                name={`answer-${answer.id}`}
                className="size-4 rounded-full border-0 p-0 accent-primary"
                checked={chosen[answer.id] === option.id}
                onChange={() => onChange(answer.id, option.id)}
              />
              <span>{option.label}</span>
              {option.id === answer.recommended && <span className="text-muted-foreground">recommended</span>}
            </label>
          ))}
        </fieldset>
      ))}
    </>
  )
}

type NoteProps = { spec: NoteSpec; value: string; onChange: (value: string) => void }

export function NoteField({ spec, value, onChange }: NoteProps) {
  return (
    <div className="grid gap-1">
      <Textarea
        autoFocus
        aria-label={spec.say}
        value={value}
        placeholder={`${spec.say}. ${spec.prompt}`}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

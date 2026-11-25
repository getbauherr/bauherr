'use client'

import { useState } from 'react'
import { OptionList } from '../assistant-ui/elements/option-list'
import { Button } from '../ui/button'
import type { RequestQuestion } from '../../../../core/requests/questions'

export const answersText = (questions: RequestQuestion[], chosen: Record<string, string>): string =>
  questions
    .filter((q) => chosen[q.field] !== undefined)
    .map((q, i) => `${i + 1}. ${q.text} ${chosen[q.field]}`)
    .join('\n')

export function RequestQuestions({
  questions,
  busy,
  onAnswer,
}: {
  questions: RequestQuestion[]
  busy: boolean
  onAnswer: (text: string) => void
}) {
  const [chosen, setChosen] = useState<Record<string, string>>({})
  if (questions.length === 0) return null
  const accept = Object.fromEntries(questions.map((q) => [q.field, q.suggested]))
  return (
    <div className="grid gap-3" data-testid="request-questions">
      {questions.map((q, i) => (
        <div key={q.field} className="grid gap-1">
          <p className="m-0 font-medium">
            {i + 1}. {q.text}
          </p>
          <OptionList
            options={q.options.map((option) => ({ id: option, label: option }))}
            defaultValue={[q.suggested]}
            confirmLabel="Use this answer"
            onConfirm={([id]) => setChosen((now) => ({ ...now, [q.field]: id ?? q.suggested }))}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || Object.keys(chosen).length === 0}
          onClick={() => onAnswer(answersText(questions, chosen))}
        >
          Send my answers
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onAnswer(answersText(questions, accept))}
        >
          Accept every suggestion
        </Button>
      </div>
    </div>
  )
}

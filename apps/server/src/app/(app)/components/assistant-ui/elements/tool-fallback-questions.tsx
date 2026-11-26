'use client'

import { useState } from 'react'
import {
  type ToolApprovalAnswer,
  type ToolApprovalQuestion,
  type ToolApprovalQuestionOption,
} from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { questionAcceptsText } from './tool-fallback-approval-model'

export const pressable = 'active:scale-[0.98]'

const toggleOption = (
  chosen: readonly string[],
  question: ToolApprovalQuestion,
  optionId: string,
): readonly string[] => {
  if (chosen.includes(optionId)) return chosen.filter((id) => id !== optionId)
  return question.multiple ? [...chosen, optionId] : [optionId]
}

function useQuestionAnswers(questions: readonly ToolApprovalQuestion[]) {
  const [selected, setSelected] = useState<ReadonlyMap<string, readonly string[]>>(() => new Map())
  const [typed, setTyped] = useState<ReadonlyMap<string, string>>(() => new Map())
  const toggle = (question: ToolApprovalQuestion, optionId: string) =>
    setSelected((current) =>
      new Map(current).set(question.id, toggleOption(current.get(question.id) ?? [], question, optionId)),
    )
  const setText = (id: string, text: string) => setTyped((current) => new Map(current).set(id, text))
  const answerOf = (question: ToolApprovalQuestion): ToolApprovalAnswer => {
    const optionIds = selected.get(question.id) ?? []
    const draft = typed.get(question.id)
    const text = draft?.trim() ? draft : undefined
    return {
      ...(optionIds.length > 0 && { optionIds }),
      ...(text !== undefined && { text }),
    }
  }
  const complete =
    questions.length > 0 &&
    questions.every((question) => {
      const answer = answerOf(question)
      return answer.optionIds !== undefined || answer.text !== undefined
    })
  return { selected, typed, toggle, setText, answerOf, complete }
}

function OptionButton({
  option,
  pressed,
  described,
  locked,
  onToggle,
}: {
  option: ToolApprovalQuestionOption
  pressed: boolean
  described: boolean
  locked: boolean
  onToggle: () => void
}) {
  return (
    <Button
      size="sm"
      variant={pressed ? 'default' : 'outline'}
      className={cn(pressable, described && 'h-auto flex-col items-start gap-0.5 py-2 text-start whitespace-normal')}
      aria-pressed={pressed}
      onClick={onToggle}
      disabled={locked}
    >
      <span>{option.label}</span>
      {option.description ? <span className="text-xs font-normal opacity-80">{option.description}</span> : null}
    </Button>
  )
}

function QuestionOptions({
  question,
  chosen,
  locked,
  onToggle,
}: {
  question: ToolApprovalQuestion
  chosen: readonly string[]
  locked: boolean
  onToggle: (optionId: string) => void
}) {
  const options = question.options
  if (!options || options.length === 0) return null
  const described = options.some((option) => option.description)
  return (
    <div className={cn('flex gap-2', described ? 'flex-col items-stretch' : 'flex-wrap items-center')}>
      {options.map((option) => (
        <OptionButton
          key={option.id}
          option={option}
          pressed={chosen.includes(option.id)}
          described={described}
          locked={locked}
          onToggle={() => onToggle(option.id)}
        />
      ))}
    </div>
  )
}

function QuestionBlock({
  question,
  chosen,
  text,
  locked,
  onToggle,
  onText,
}: {
  question: ToolApprovalQuestion
  chosen: readonly string[]
  text: string
  locked: boolean
  onToggle: (optionId: string) => void
  onText: (text: string) => void
}) {
  return (
    <div
      role="group"
      aria-label={question.prompt}
      data-slot="tool-fallback-approval-question"
      className="aui-tool-fallback-approval-question flex flex-col gap-2"
    >
      <p className="aui-tool-fallback-approval-question-prompt text-foreground whitespace-pre-line">
        {question.header ? (
          <span className="text-muted-foreground me-1.5 text-xs font-medium uppercase">{question.header}</span>
        ) : null}
        {question.prompt}
      </p>
      <QuestionOptions question={question} chosen={chosen} locked={locked} onToggle={onToggle} />
      {questionAcceptsText(question) ? (
        <Textarea
          value={text}
          onChange={(event) => onText(event.target.value)}
          disabled={locked}
          aria-label={question.prompt}
          placeholder={question.options?.length ? 'Or type an answer' : 'Type your answer'}
        />
      ) : null}
    </div>
  )
}

function ToolFallbackApprovalQuestions({
  questions,
  dismissible,
  locked,
  onSend,
  onDismiss,
}: {
  questions: readonly ToolApprovalQuestion[]
  dismissible: boolean
  locked: boolean
  onSend: (answers: Record<string, ToolApprovalAnswer>) => void
  onDismiss: () => void
}) {
  const { selected, typed, toggle, setText, answerOf, complete } = useQuestionAnswers(questions)
  const send = () => {
    if (locked || !complete) return
    onSend(Object.fromEntries(questions.map((question) => [question.id, answerOf(question)])))
  }
  return (
    <>
      {questions.map((question) => (
        <QuestionBlock
          key={question.id}
          question={question}
          chosen={selected.get(question.id) ?? []}
          text={typed.get(question.id) ?? ''}
          locked={locked}
          onToggle={(optionId) => toggle(question, optionId)}
          onText={(text) => setText(question.id, text)}
        />
      ))}
      <div className="flex items-center gap-2">
        <Button size="sm" className={pressable} onClick={send} disabled={locked || !complete}>
          Send
        </Button>
        {dismissible ? (
          <Button size="sm" variant="outline" className={pressable} onClick={onDismiss} disabled={locked}>
            Dismiss
          </Button>
        ) : null}
      </div>
    </>
  )
}

export { ToolFallbackApprovalQuestions }

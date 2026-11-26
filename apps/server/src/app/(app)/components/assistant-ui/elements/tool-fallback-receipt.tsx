'use client'

import { CheckIcon, CircleMinusIcon, XCircleIcon } from 'lucide-react'
import { type ToolApprovalAnswer, type ToolApprovalQuestion } from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import {
  answerLabels,
  approvalNotes,
  approvalReceipt,
  type Approval,
  type ApprovalReceipt,
} from './tool-fallback-approval-model'

const receiptIcons = {
  allowed: CheckIcon,
  refused: XCircleIcon,
  closed: CircleMinusIcon,
} satisfies Record<ApprovalReceipt['outcome'], React.ElementType>

function ReceiptAnswer({
  question,
  answer,
}: {
  question: ToolApprovalQuestion
  answer: ToolApprovalAnswer | undefined
}) {
  const labels = answerLabels(question, answer)
  if (labels.length === 0) return null
  return (
    <p className="aui-tool-fallback-approval-receipt-answer whitespace-pre-line">
      <span className="text-muted-foreground">{question.header ?? question.prompt}</span> · {labels.join(', ')}
    </p>
  )
}

function ReceiptAnswers({ approval }: { approval: Approval }) {
  const { answers, questions } = approval
  if (!answers) return null
  return questions?.map((question) => (
    <ReceiptAnswer
      key={question.id}
      question={question}
      answer={Object.hasOwn(answers, question.id) ? answers[question.id] : undefined}
    />
  ))
}

function ToolFallbackApprovalReceipt({
  approval,
  className,
  receiptRef,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  approval: Approval
  receiptRef: React.RefCallback<HTMLDivElement>
}) {
  const receipt = approvalReceipt(approval)
  const Icon = receiptIcons[receipt.outcome]
  return (
    <div
      ref={receiptRef}
      data-slot="tool-fallback-approval-receipt"
      data-outcome={receipt.outcome}
      tabIndex={-1}
      className={cn('aui-tool-fallback-approval-receipt flex flex-col gap-1.5 pt-1', className)}
      {...props}
    >
      {approval.prompt ? (
        <p className="aui-tool-fallback-approval-prompt text-muted-foreground whitespace-pre-line">{approval.prompt}</p>
      ) : null}
      <p className="aui-tool-fallback-approval-receipt-label flex items-center gap-1.5">
        <Icon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
        <span className="font-medium">{receipt.label}</span>
        {receipt.option !== undefined ? <span className="text-muted-foreground">· {receipt.option}</span> : null}
      </p>
      <ReceiptAnswers approval={approval} />
      {approvalNotes(approval).map((text) => (
        <p key={text} className="aui-tool-fallback-approval-receipt-note text-muted-foreground whitespace-pre-line">
          {text}
        </p>
      ))}
    </div>
  )
}

export { ToolFallbackApprovalReceipt }

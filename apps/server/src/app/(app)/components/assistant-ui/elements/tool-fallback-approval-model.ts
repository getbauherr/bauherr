import {
  toolApprovalAcceptsText,
  type ToolApprovalAnswer,
  type ToolApprovalOption,
  type ToolApprovalQuestion,
  type ToolCallMessagePart,
  type ToolCallMessagePartProps,
  type ToolCallMessagePartStatus,
} from '@assistant-ui/react'

export type Approval = NonNullable<ToolCallMessagePart['approval']>
export type MaybeApproval = ToolCallMessagePart['approval']
export type RespondToApproval = ToolCallMessagePartProps['respondToApproval'] | undefined

export const APPROVED_RESULT = 'Approved by user'
export const DENIED_RESULT = 'User denied tool execution'

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
  'allow-once': 'Allow',
  'allow-always': 'Always allow',
  'reject-once': 'Deny',
  'reject-always': 'Always deny',
}

export const isKnownKind = (kind: string) => Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, kind)
export const isAllowKind = (kind: string) => kind === 'allow-once' || kind === 'allow-always'

export const approvalOptionLabel = (option: ToolApprovalOption) =>
  option.label ?? (isKnownKind(option.kind) ? APPROVAL_OPTION_DEFAULT_LABELS[option.kind] : undefined) ?? option.id

export const isQuestion = (approval: MaybeApproval) =>
  approval?.display === 'select' || approval?.display === 'text' || approval?.display === 'questions'

export const questionAcceptsText = (question: ToolApprovalQuestion) =>
  !question.options?.length || question.allowFreeform === true

export const answerLabels = (question: ToolApprovalQuestion, answer: ToolApprovalAnswer | undefined) => [
  ...(answer?.optionIds ?? []).map((id) => question.options?.find((option) => option.id === id)?.label ?? id),
  ...(answer?.text?.trim() ? [answer.text] : []),
]

export const isSettled = (approval: MaybeApproval) =>
  approval != null && (approval.approved !== undefined || approval.resolution !== undefined)

export const isInterruptRequest = (status: ToolCallMessagePartStatus | undefined) =>
  status?.type === 'requires-action' && status.reason === 'interrupt'

export const offersInterruptAction = (
  status: ToolCallMessagePartStatus | undefined,
  approval: MaybeApproval,
  interrupt: ToolCallMessagePart['interrupt'],
) => !isInterruptRequest(status) || approval != null || interrupt != null

export const isPendingHidden = (
  approval: MaybeApproval,
  status: ToolCallMessagePartStatus | undefined,
  submitted: boolean,
) =>
  approval != null &&
  !isSettled(approval) &&
  status !== undefined &&
  status.type !== 'requires-action' &&
  !(submitted && status.type === 'running')

export type ApprovalReceipt = {
  outcome: 'allowed' | 'refused' | 'closed'
  label: string
  option?: string | undefined
}

const RECEIPT_VERBS = {
  allowed: { answered: 'Answered', plain: 'Allowed' },
  refused: { answered: 'Dismissed', plain: 'Denied' },
}

const wasAnswered = (approval: Approval, chosen: ToolApprovalOption | undefined) =>
  isQuestion(approval) || (chosen !== undefined && !isKnownKind(chosen.kind))

export const approvalReceipt = (approval: Approval): ApprovalReceipt => {
  if (approval.resolution !== undefined) {
    return {
      outcome: 'closed',
      label: approval.resolution === 'cancelled' ? 'Cancelled before a decision' : 'Expired before a decision',
    }
  }
  const chosen = approval.options?.find((option) => option.id === approval.optionId)
  const option = chosen !== undefined ? approvalOptionLabel(chosen) : approval.optionId
  const automatic = approval.isAutomatic ? ' automatically' : ''
  const outcome = approval.approved ? 'allowed' : 'refused'
  const verb = RECEIPT_VERBS[outcome][wasAnswered(approval, chosen) ? 'answered' : 'plain']
  return { outcome, label: `${verb}${automatic}`, option }
}

export const approvalNotes = (approval: Approval) => [
  ...new Set(
    [approval.text, approval.reason].filter((value): value is string => typeof value === 'string' && value !== ''),
  ),
]

export type PendingView = {
  declaredOptions: readonly ToolApprovalOption[] | undefined
  acceptsText: boolean
  question: boolean
  dismissible: boolean
  confirming: ToolApprovalOption | undefined
}

export const derivePendingView = (
  approval: MaybeApproval,
  respondToApproval: RespondToApproval,
  confirmingId: string | null,
): PendingView => {
  const declaredOptions = respondToApproval ? approval?.options : undefined
  const question = isQuestion(approval)
  return {
    declaredOptions,
    acceptsText: approval != null && respondToApproval != null && toolApprovalAcceptsText(approval),
    question,
    dismissible: question && respondToApproval != null && approval?.dismissible === true,
    confirming: confirmingId != null ? declaredOptions?.find((option) => option.id === confirmingId) : undefined,
  }
}

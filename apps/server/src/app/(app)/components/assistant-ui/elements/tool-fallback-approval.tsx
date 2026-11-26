'use client'

import { forwardRef, useRef } from 'react'
import { useAuiState } from '@assistant-ui/react'
import {
  derivePendingView,
  isPendingHidden,
  isSettled,
  offersInterruptAction,
  type Approval,
  type PendingView,
  type RespondToApproval,
} from './tool-fallback-approval-model'
import {
  useApprovalActions,
  useApprovalFocus,
  useApprovalState,
  type ApprovalActions,
  type ApprovalInputs,
  type ApprovalState,
} from './tool-fallback-approval-hooks'
import {
  AnswerField,
  ApprovalError,
  ApprovalPrompt,
  ApprovalShell,
  ConfirmView,
  DefaultView,
  DismissButton,
  OptionsView,
  QuestionView,
  type ShellBase,
  type ViewSlots,
} from './tool-fallback-approval-views'
import { ToolFallbackApprovalQuestions } from './tool-fallback-questions'
import { ToolFallbackApprovalReceipt } from './tool-fallback-receipt'

type ToolFallbackApprovalProps = React.ComponentPropsWithoutRef<'div'> & ApprovalInputs

type PendingProps = {
  shell: ShellBase
  approval: Approval | undefined
  respondToApproval: RespondToApproval
  locked: boolean
  state: ApprovalState
  actions: ApprovalActions
}

function QuestionsView({
  slots,
  approval,
  actions,
  respondToApproval,
}: {
  slots: ViewSlots
  approval: Approval
  actions: ApprovalActions
  respondToApproval: NonNullable<RespondToApproval>
}) {
  return (
    <ApprovalShell variant="wide" shell={slots.shell}>
      {slots.prompt}
      <ToolFallbackApprovalQuestions
        questions={approval.questions ?? []}
        dismissible={approval.dismissible === true}
        locked={slots.locked}
        onSend={(answers) => actions.submit(() => respondToApproval({ answers }))}
        onDismiss={actions.dismiss}
      />
      {slots.errorNode}
    </ApprovalShell>
  )
}

function buildSlots(
  { shell, approval, locked, state, actions }: PendingProps,
  view: PendingView,
  dismissButton: React.ReactNode,
): ViewSlots {
  return {
    shell,
    locked,
    prompt: <ApprovalPrompt prompt={approval?.prompt} />,
    errorNode: <ApprovalError error={state.error} />,
    answerField: view.acceptsText ? (
      <AnswerField
        question={view.question}
        prompt={approval?.prompt}
        answer={state.answer}
        locked={locked}
        onChange={state.setAnswer}
        onSend={actions.submitAnswer}
        dismissButton={dismissButton}
      />
    ) : null,
  }
}

function PendingApproval(props: PendingProps) {
  const { shell, approval, respondToApproval, locked, state, actions } = props
  const view = derivePendingView(approval, respondToApproval, state.confirmingId)
  const dismissButton = view.dismissible ? <DismissButton locked={locked} onClick={actions.dismiss} /> : null
  const slots = buildSlots(props, view, dismissButton)
  if (approval?.display === 'questions' && respondToApproval) {
    return <QuestionsView slots={slots} approval={approval} actions={actions} respondToApproval={respondToApproval} />
  }
  if (view.confirming) {
    const confirming = view.confirming
    return (
      <ConfirmView
        shell={shell}
        confirming={confirming}
        locked={locked}
        onConfirm={() => actions.respondWithOption(confirming)}
        onBack={actions.goBack}
      />
    )
  }
  if (view.declaredOptions && view.declaredOptions.length > 0) {
    return (
      <OptionsView
        slots={slots}
        options={view.declaredOptions}
        question={view.question}
        acceptsText={view.acceptsText}
        onOption={actions.handleOption}
        onDeny={() => actions.respond(false)}
        dismissButton={dismissButton}
      />
    )
  }
  if (view.question) {
    return <QuestionView slots={slots} acceptsText={view.acceptsText} dismissButton={dismissButton} />
  }
  return <DefaultView slots={slots} onAllow={() => actions.respond(true)} onDeny={() => actions.respond(false)} />
}

function ToolFallbackApprovalImpl({
  className,
  forwardedRef,
  carryFocusRef,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
  status,
  ...props
}: Omit<ToolFallbackApprovalProps, 'ref'> & {
  forwardedRef: React.ForwardedRef<HTMLDivElement>
  carryFocusRef: React.MutableRefObject<boolean>
}) {
  const state = useApprovalState(status?.type === 'requires-action')
  const voiceActive = useAuiState((s) => s.thread.voice !== undefined)
  const canAnswer = useAuiState((s) => s.thread.capabilities.answerToolCall)
  const locked = state.submitted || voiceActive
  const hidePending = isPendingHidden(approval, status, state.submitted)
  const { setReceipt, setPendingGroup, focusPendingGroup } = useApprovalFocus({
    approval,
    carryFocusRef,
    forwardedRef,
    hidePending,
  })
  const actions = useApprovalActions({
    inputs: { addResult, resume, interrupt, approval, respondToApproval, status },
    state,
    locked,
    focusPendingGroup,
  })
  if (approval != null && isSettled(approval)) {
    return <ToolFallbackApprovalReceipt approval={approval} receiptRef={setReceipt} className={className} {...props} />
  }
  if (hidePending || !offersInterruptAction(status, approval, interrupt)) return null
  const shell: ShellBase = { className, divProps: props, groupRef: setPendingGroup }
  if (!canAnswer) {
    return approval?.prompt ? (
      <ApprovalShell variant="default" shell={shell}>
        <ApprovalPrompt prompt={approval.prompt} />
      </ApprovalShell>
    ) : null
  }
  return (
    <PendingApproval
      shell={shell}
      approval={approval}
      respondToApproval={respondToApproval}
      locked={locked}
      state={state}
      actions={actions}
    />
  )
}

const ToolFallbackApproval = forwardRef<HTMLDivElement, ToolFallbackApprovalProps>(
  function ToolFallbackApproval(props, ref) {
    const carryFocusRef = useRef(false)
    return (
      <ToolFallbackApprovalImpl key={props.approval?.id} carryFocusRef={carryFocusRef} forwardedRef={ref} {...props} />
    )
  },
)

export { ToolFallbackApproval }

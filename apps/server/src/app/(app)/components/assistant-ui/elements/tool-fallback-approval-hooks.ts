'use client'

import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { type ToolApprovalOption, type ToolCallMessagePart, type ToolCallMessagePartProps } from '@assistant-ui/react'
import {
  APPROVED_RESULT,
  DENIED_RESULT,
  isInterruptRequest,
  isKnownKind,
  type MaybeApproval,
} from './tool-fallback-approval-model'

export function useApprovalState(isRequiresAction: boolean) {
  const [submitted, setSubmitted] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction)
  const [attempt, setAttempt] = useState(0)
  const attemptRef = useRef(attempt)
  useLayoutEffect(() => {
    attemptRef.current = attempt
  }, [attempt])
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction)
    if (isRequiresAction) {
      setSubmitted(false)
      setConfirmingId(null)
      setAnswer('')
      setError(null)
      setAttempt(attempt + 1)
    }
  }
  return {
    submitted,
    setSubmitted,
    confirmingId,
    setConfirmingId,
    answer,
    setAnswer,
    error,
    setError,
    attempt,
    attemptRef,
  }
}

export type ApprovalState = ReturnType<typeof useApprovalState>

export function useApprovalFocus({
  approval,
  carryFocusRef,
  forwardedRef,
  hidePending,
}: {
  approval: MaybeApproval
  carryFocusRef: React.MutableRefObject<boolean>
  forwardedRef: React.ForwardedRef<HTMLDivElement>
  hidePending: boolean
}) {
  const pendingGroupRef = useRef<HTMLDivElement | null>(null)
  const receiptRef = useRef<HTMLDivElement | null>(null)
  const focusReceiptRef = useRef<string | null | undefined>(null)
  useLayoutEffect(() => {
    if (carryFocusRef.current) {
      carryFocusRef.current = false
      pendingGroupRef.current?.focus({ preventScroll: true })
    }
    return () => {
      const element = pendingGroupRef.current ?? receiptRef.current
      carryFocusRef.current = element?.contains(element.ownerDocument.activeElement) ?? false
    }
  }, [carryFocusRef])
  useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(
    forwardedRef,
    () => pendingGroupRef.current ?? receiptRef.current,
  )
  const setReceipt = useCallback(
    (element: HTMLDivElement | null) => {
      receiptRef.current = element
      if (!element) return
      const shouldFocus = focusReceiptRef.current === approval?.id
      focusReceiptRef.current = null
      if (shouldFocus) element.focus({ preventScroll: true })
    },
    [approval?.id],
  )
  const setPendingGroup = useCallback(
    (element: HTMLDivElement | null) => {
      const group = pendingGroupRef.current
      focusReceiptRef.current = !element && group?.contains(group.ownerDocument.activeElement) ? approval?.id : null
      pendingGroupRef.current = element
    },
    [approval?.id],
  )
  useLayoutEffect(() => {
    if (hidePending) focusReceiptRef.current = null
  }, [hidePending])
  const focusPendingGroup = () => {
    const group = pendingGroupRef.current
    if (group?.contains(group.ownerDocument.activeElement)) {
      group.focus({ preventScroll: true })
    }
  }
  return { setReceipt, setPendingGroup, focusPendingGroup }
}

function useSubmit(state: ApprovalState, focusPendingGroup: () => void) {
  const { attempt, attemptRef, setSubmitted, setConfirmingId, setError } = state
  return (send: () => Promise<void> | void) => {
    focusPendingGroup()
    setSubmitted(true)
    setConfirmingId(null)
    setError(null)
    void (async () => {
      try {
        await send()
      } catch (sendError) {
        if (attemptRef.current !== attempt) return
        setSubmitted(false)
        setError(sendError instanceof Error ? sendError.message : String(sendError))
      }
    })()
  }
}

export type ApprovalInputs = Partial<
  Pick<ToolCallMessagePartProps, 'addResult' | 'resume' | 'respondToApproval' | 'status'>
> & {
  interrupt?: ToolCallMessagePart['interrupt']
  approval?: ToolCallMessagePart['approval']
}

export function useApprovalActions({
  inputs,
  state,
  locked,
  focusPendingGroup,
}: {
  inputs: ApprovalInputs
  state: ApprovalState
  locked: boolean
  focusPendingGroup: () => void
}) {
  const { addResult, resume, interrupt, approval, respondToApproval, status } = inputs
  const submit = useSubmit(state, focusPendingGroup)
  const typedNote = () => (state.answer.trim() ? { text: state.answer } : {})
  const respond = (approved: boolean) => {
    if (locked) return
    if (approval != null && approval.approved === undefined && respondToApproval) {
      submit(() => respondToApproval({ approved, ...typedNote() }))
    } else if (interrupt) {
      submit(() => resume?.({ approved }))
    } else if (!isInterruptRequest(status)) {
      submit(() => addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT))
    }
  }
  const respondWithOption = (option: ToolApprovalOption) => {
    if (locked) return
    const body = isKnownKind(option.kind) ? { optionId: option.id } : { optionId: option.id, approved: true }
    submit(() => respondToApproval?.({ ...body, ...typedNote() }))
  }
  const submitAnswer = () => {
    if (locked) return
    submit(() => respondToApproval?.({ text: state.answer }))
  }
  const dismiss = () => {
    if (locked) return
    submit(() => respondToApproval?.({ approved: false }))
  }
  const handleOption = (option: ToolApprovalOption) => {
    if (!option.confirm) {
      respondWithOption(option)
      return
    }
    focusPendingGroup()
    state.setConfirmingId(option.id)
  }
  const goBack = () => {
    focusPendingGroup()
    state.setConfirmingId(null)
  }
  return { submit, respond, respondWithOption, submitAnswer, dismiss, handleOption, goBack }
}

export type ApprovalActions = ReturnType<typeof useApprovalActions>

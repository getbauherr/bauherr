'use client'

import { memo, useLayoutEffect, useRef, useState } from 'react'
import { type ToolCallMessagePartComponent, type ToolCallMessagePartStatus } from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import { ToolFallbackRoot, ToolFallbackTrigger } from './tool-fallback-root'
import {
  formatUnknownValue,
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackResult,
} from './tool-fallback-parts'
import { ToolFallbackApproval } from './tool-fallback-approval'
import { isSettled, offersInterruptAction, type MaybeApproval } from './tool-fallback-approval-model'

function useOpenOnRequiresAction(isRequiresAction: boolean) {
  const [open, setOpen] = useState(isRequiresAction)
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction)
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction)
    if (isRequiresAction) setOpen(true)
  }
  return [open, setOpen] as const
}

function useApprovalFocusReturn(
  approval: MaybeApproval,
  status: ToolCallMessagePartStatus | undefined,
  isRequiresAction: boolean,
) {
  const approvalHadFocusRef = useRef(false)
  const approvalElementRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => {
    const focusedElement = approvalElementRef.current
    if (!focusedElement || focusedElement.isConnected || isRequiresAction || !approvalHadFocusRef.current) {
      return
    }
    const shouldFocusTrigger = approval == null || !isSettled(approval)
    approvalHadFocusRef.current = false
    const { activeElement, body } = focusedElement.ownerDocument
    if (shouldFocusTrigger && (activeElement == null || activeElement === body)) {
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [approval, isRequiresAction, status?.type])
  const onFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const root = event.currentTarget.closest('[data-slot="tool-fallback-root"]')
    triggerRef.current = root?.querySelector<HTMLButtonElement>('[data-slot="tool-fallback-trigger"]') ?? null
    approvalElementRef.current = event.currentTarget
    approvalHadFocusRef.current = true
  }
  const onBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget
    const stillFocused = relatedTarget
      ? event.currentTarget.contains(relatedTarget)
      : event.currentTarget.contains(event.currentTarget.ownerDocument.activeElement)
    if (!stillFocused) approvalHadFocusRef.current = false
  }
  return { onFocusCapture, onBlurCapture }
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  isError,
  status,
  responseDeliveryStatus,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
}) => {
  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled'
  const isRequiresAction = status?.type === 'requires-action'
  const shouldRenderApproval =
    approval != null || (isRequiresAction && offersInterruptAction(status, approval, interrupt))
  const [open, setOpen] = useOpenOnRequiresAction(isRequiresAction)
  const focusHandlers = useApprovalFocusReturn(approval, status, isRequiresAction)
  const resultValue: unknown = result
  return (
    <ToolFallbackRoot open={open} onOpenChange={setOpen}>
      <ToolFallbackTrigger
        toolName={toolName}
        status={status}
        isError={isError}
        responseDeliveryStatus={responseDeliveryStatus}
      />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs argsText={argsText} className={cn(isCancelled && 'opacity-60')} />
        {shouldRenderApproval && (
          <ToolFallbackApproval
            addResult={addResult}
            resume={resume}
            interrupt={interrupt}
            approval={approval}
            respondToApproval={respondToApproval}
            status={status}
            {...focusHandlers}
          />
        )}
        <ToolFallbackResult result={resultValue} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  )
}

const ToolFallback = Object.assign(memo(ToolFallbackImpl), {
  displayName: 'ToolFallback',
  Root: ToolFallbackRoot,
  Trigger: ToolFallbackTrigger,
  Content: ToolFallbackContent,
  Args: ToolFallbackArgs,
  Result: ToolFallbackResult,
  Error: ToolFallbackError,
  Approval: ToolFallbackApproval,
})

export {
  formatUnknownValue,
  offersInterruptAction,
  ToolFallback,
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
  ToolFallbackApproval,
}

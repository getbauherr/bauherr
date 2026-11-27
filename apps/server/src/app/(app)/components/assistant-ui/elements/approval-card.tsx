'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { paper } from './surfaces'
import { useReceiptFocus } from './receipt-focus'
import {
  ApprovalBody,
  ApprovalHeader,
  ApprovalReceipt,
  ApprovalRequestActions,
  type ApprovalCardProps,
} from './approval-card.parts'

export type { ApprovalState } from './approval-card.parts'

export function ApprovalCard({
  state,
  command,
  title,
  subtitle,
  description,
  details,
  variant = 'default',
  quiet,
  icon,
  onAllowOnce,
  onAlwaysAllow,
  onDeny,
  allowOnceLabel,
  alwaysAllowLabel,
  denyLabel,
  statusLabel,
  className,
  ...props
}: ApprovalCardProps) {
  const titleId = useId()
  const descriptionId = useId()
  const { receiptRef, focusHandlers } = useReceiptFocus<HTMLDivElement>(props)
  return (
    <div
      {...props}
      {...focusHandlers}
      role="group"
      data-variant={variant}
      data-slot="approval-card"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(paper, 'flex w-full max-w-sm flex-col gap-3.5 rounded-[20px] p-4', className)}
    >
      <ApprovalHeader titleId={titleId} title={title} subtitle={subtitle} icon={icon} variant={variant} />
      <ApprovalBody descriptionId={descriptionId} description={description} command={command} details={details} />
      <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
        {state === 'request' ? (
          <ApprovalRequestActions
            variant={variant}
            quiet={quiet}
            onAllowOnce={onAllowOnce}
            onAlwaysAllow={onAlwaysAllow}
            onDeny={onDeny}
            allowOnceLabel={allowOnceLabel}
            alwaysAllowLabel={alwaysAllowLabel}
            denyLabel={denyLabel}
          />
        ) : (
          <ApprovalReceipt state={state} statusLabel={statusLabel} receiptRef={receiptRef} />
        )}
      </div>
    </div>
  )
}

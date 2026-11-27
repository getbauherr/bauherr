import type { ComponentProps, ReactNode, Ref } from 'react'
import { CheckIcon, Loader2Icon, TerminalIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { field, ghostButton, inkButton, mono } from './surfaces'

export type ApprovalState = 'request' | 'running' | 'done' | 'denied'

type ReceiptState = Exclude<ApprovalState, 'request'>

type ApprovalDetail = { label: string; value: string }

export type ApprovalCardProps = Omit<
  ComponentProps<'div'>,
  | 'children'
  | 'state'
  | 'command'
  | 'title'
  | 'subtitle'
  | 'description'
  | 'details'
  | 'variant'
  | 'quiet'
  | 'icon'
  | 'onAllowOnce'
  | 'onAlwaysAllow'
  | 'onDeny'
  | 'allowOnceLabel'
  | 'alwaysAllowLabel'
  | 'denyLabel'
  | 'statusLabel'
> & {
  state: ApprovalState
  command?: string | undefined
  title: string
  subtitle: string
  description?: string | undefined
  details?: readonly ApprovalDetail[] | undefined
  variant?: 'default' | 'destructive' | undefined
  quiet?: boolean | undefined
  icon?: ReactNode | undefined
  onAllowOnce?: (() => void) | undefined
  onAlwaysAllow?: (() => void) | undefined
  onDeny?: (() => void) | undefined
  allowOnceLabel?: string | undefined
  alwaysAllowLabel?: string | undefined
  denyLabel?: string | undefined
  statusLabel?: string | undefined
}

const receiptText: Record<ReceiptState, string> = {
  running: 'Approved, running',
  done: 'Finished',
  denied: 'Denied',
}

const receiptIcon: Record<ReceiptState, ReactNode> = {
  running: <Loader2Icon className="text-muted-foreground size-3.5 animate-spin motion-reduce:animate-none" />,
  denied: <XIcon className="text-muted-foreground size-3.5" />,
  done: <CheckIcon className="size-3.5 text-ok" />,
}

const actionButton = 'h-8 px-3.5 text-xs font-medium whitespace-nowrap'

const quietAllow = 'border border-border text-foreground hover:bg-accent motion-reduce:transition-none'

const destructiveAllow = cn(
  'text-background bg-danger transition-[background-color,scale] duration-150',
  'hover:bg-danger/90 active:scale-[0.96] motion-reduce:transition-none',
)

export function ApprovalHeader({
  titleId,
  title,
  subtitle,
  icon,
  variant,
}: {
  titleId: string
  title: string
  subtitle: string
  icon: ReactNode
  variant: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          variant === 'destructive' ? 'bg-danger/10 text-danger' : 'bg-foreground/[0.05] text-muted-foreground',
        )}
      >
        {icon ?? <TerminalIcon className="size-4" />}
      </span>
      <div className="flex flex-col">
        <p id={titleId} className="text-[13.5px] font-medium">
          {title}
        </p>
        <p className="text-muted-foreground text-xs">{subtitle}</p>
      </div>
    </div>
  )
}

export function ApprovalBody({
  descriptionId,
  description,
  command,
  details,
}: {
  descriptionId: string
  description: string | undefined
  command: string | undefined
  details: readonly ApprovalDetail[] | undefined
}) {
  return (
    <>
      {description ? (
        <p id={descriptionId} className="text-foreground/75 text-[13px]">
          {description}
        </p>
      ) : null}

      {command ? (
        <div className={cn(field, 'text-foreground/80 rounded-xl px-3.5 py-2.5 font-mono text-xs')}>{command}</div>
      ) : null}

      {details?.length ? (
        <dl className={cn(field, 'flex flex-col gap-2 rounded-xl px-3.5 py-2.5')}>
          {details.map((detail, index) => (
            <div
              key={`${detail.label}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 text-xs"
            >
              <dt className={cn(mono, 'text-muted-foreground')}>{detail.label}</dt>
              <dd className="text-foreground/80 break-words">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  )
}

export function ApprovalRequestActions({
  variant,
  quiet,
  onAllowOnce,
  onAlwaysAllow,
  onDeny,
  allowOnceLabel = 'Allow once',
  alwaysAllowLabel = 'Always allow',
  denyLabel = 'Deny',
}: Pick<
  ApprovalCardProps,
  'variant' | 'quiet' | 'onAllowOnce' | 'onAlwaysAllow' | 'onDeny' | 'allowOnceLabel' | 'alwaysAllowLabel' | 'denyLabel'
>) {
  return (
    <>
      {onDeny && (
        <button type="button" data-slot="approval-card-deny" onClick={onDeny} className={cn(ghostButton, actionButton)}>
          {denyLabel}
        </button>
      )}
      {onAlwaysAllow && (
        <button
          type="button"
          data-slot="approval-card-always-allow"
          onClick={onAlwaysAllow}
          className={cn(ghostButton, actionButton)}
        >
          {alwaysAllowLabel}
        </button>
      )}
      {onAllowOnce && (
        <button
          type="button"
          data-slot="approval-card-allow-once"
          onClick={onAllowOnce}
          className={cn(
            variant === 'destructive' ? destructiveAllow : quiet ? quietAllow : inkButton,
            'flex h-8 items-center rounded-full px-3.5 text-xs font-medium whitespace-nowrap',
          )}
        >
          {allowOnceLabel}
        </button>
      )}
    </>
  )
}

export function ApprovalReceipt({
  state,
  statusLabel,
  receiptRef,
}: {
  state: ReceiptState
  statusLabel: string | undefined
  receiptRef: Ref<HTMLDivElement>
}) {
  return (
    <div
      key={state}
      ref={receiptRef}
      tabIndex={-1}
      role="status"
      className={cn(
        'fade-in animate-in text-muted-foreground flex items-center gap-2 text-xs',
        'duration-300 motion-reduce:animate-none',
      )}
    >
      {receiptIcon[state]}
      {statusLabel ?? receiptText[state]}
    </div>
  )
}

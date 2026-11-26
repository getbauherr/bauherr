'use client'

import { useCallback, useRef, useState } from 'react'
import { AlertCircleIcon, CheckIcon, ChevronDownIcon, LoaderIcon, XCircleIcon } from 'lucide-react'
import {
  useScrollLock,
  useToolCallElapsed,
  type ToolCallMessagePart,
  type ToolCallMessagePartStatus,
} from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import { CollapsibleRoot as Collapsible, CollapsibleTrigger } from './collapsible-root'

const ANIMATION_DURATION = 200

export type ToolFallbackRootProps = Omit<React.ComponentProps<typeof Collapsible>, 'open' | 'onOpenChange'> & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen
  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll()
      if (!isControlled) {
        setUncontrolledOpen(open)
      }
      controlledOnOpenChange?.(open)
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  )
  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('aui-tool-fallback-root group/tool-fallback-root w-full', className)}
      style={
        {
          '--animation-duration': `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  )
}

type ToolStatus = ToolCallMessagePartStatus['type']

const statusIconMap: Record<ToolStatus, React.ElementType> = {
  running: LoaderIcon,
  complete: CheckIcon,
  incomplete: XCircleIcon,
  'requires-action': AlertCircleIcon,
}

const statusLabels: Record<Exclude<ToolStatus, 'incomplete'>, string> = {
  running: 'Running tool',
  complete: 'Used tool',
  'requires-action': 'Waiting on tool',
}

const formatToolDuration = (ms: number) => {
  if (ms < 1000) return '<1s'
  const seconds = ms / 1000
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`
  if (seconds < 60) return `${Math.floor(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
}

function ToolFallbackDuration({ className, ...props }: React.ComponentProps<'span'>) {
  const elapsedMs = useToolCallElapsed()
  if (elapsedMs === undefined) return null
  return (
    <span
      data-slot="tool-fallback-duration"
      className={cn('aui-tool-fallback-duration text-muted-foreground text-xs tabular-nums', className)}
      {...props}
    >
      {formatToolDuration(elapsedMs)}
    </span>
  )
}

const resolveStatusType = (status?: ToolCallMessagePartStatus, isError?: boolean): ToolStatus => {
  const reportedType = status?.type ?? 'complete'
  return reportedType === 'complete' && isError ? 'incomplete' : reportedType
}

const isCancelledStatus = (status?: ToolCallMessagePartStatus) =>
  status?.type === 'incomplete' && status.reason === 'cancelled'

const triggerLabel = (statusType: ToolStatus, isCancelled: boolean, delivery?: string) => {
  if (delivery === 'queued') return 'Reply queued, not sent yet'
  if (statusType === 'incomplete') return `${isCancelled ? 'Cancelled' : 'Failed'} tool`
  return statusLabels[statusType]
}

const triggerClass = cn(
  'aui-tool-fallback-trigger group/trigger text-muted-foreground',
  'hover:text-foreground flex w-fit max-w-full origin-left items-center gap-2',
  'py-1.5 text-sm transition-[color,scale] active:scale-[0.98]',
)

const chevronClass = cn(
  'aui-tool-fallback-trigger-chevron size-4 shrink-0',
  cn(
    'transition-transform duration-(--animation-duration)',
    'ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
  ),
  '-rotate-90',
  'group-data-open/trigger:rotate-0',
  'group-data-panel-open/trigger:rotate-0',
)

function ToolFallbackTrigger({
  toolName,
  status,
  isError,
  responseDeliveryStatus,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  toolName: string
  status?: ToolCallMessagePartStatus
  isError?: ToolCallMessagePart['isError']
  responseDeliveryStatus?: ToolCallMessagePart['responseDeliveryStatus']
}) {
  const statusType = resolveStatusType(status, isError)
  const isRunning = statusType === 'running'
  const isCancelled = isCancelledStatus(status)
  const Icon = statusIconMap[statusType]
  const label = triggerLabel(statusType, isCancelled, responseDeliveryStatus)
  return (
    <CollapsibleTrigger data-slot="tool-fallback-trigger" className={cn(triggerClass, className)} {...props}>
      <Icon
        data-slot="tool-fallback-trigger-icon"
        className={cn(
          'aui-tool-fallback-trigger-icon size-4 shrink-0',
          isCancelled && 'text-muted-foreground',
          isRunning && 'animate-spin [animation-duration:0.6s]',
        )}
      />
      <span
        data-slot="tool-fallback-trigger-label"
        className={cn(
          'aui-tool-fallback-trigger-label-wrapper inline-block min-w-0 text-start leading-none wrap-anywhere',
          isCancelled && 'text-muted-foreground line-through',
          isRunning && 'shimmer motion-reduce:animate-none',
        )}
      >
        {label}: <b>{toolName}</b>
      </span>
      <ToolFallbackDuration />
      <ChevronDownIcon data-slot="tool-fallback-trigger-chevron" className={chevronClass} />
    </CollapsibleTrigger>
  )
}

export { ToolFallbackRoot, ToolFallbackTrigger }

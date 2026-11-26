'use client'

import { type ToolCallMessagePartStatus } from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import { CollapsibleContent } from './collapsible-root'

const contentClass = cn(
  'aui-tool-fallback-content relative overflow-hidden text-sm outline-none',
  'group/collapsible-content ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none',
  'data-closed:animate-collapsible-up',
  'data-open:animate-collapsible-down',
  'data-closed:fill-mode-forwards',
  'data-closed:pointer-events-none',
  '[--tw-duration:var(--animation-duration)]',
)

const contentInnerClass = cn(
  'flex flex-col gap-2 ps-6 pt-1 pb-2 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none',
  cn(
    'group-data-open/collapsible-content:animate-in',
    'group-data-open/collapsible-content:fade-in-0',
    'group-data-open/collapsible-content:blur-in-[2px]',
    'group-data-open/collapsible-content:slide-in-from-top-1',
  ),
  cn(
    'group-data-closed/collapsible-content:animate-out',
    'group-data-closed/collapsible-content:fade-out-0',
    'group-data-closed/collapsible-content:blur-out-[2px]',
    'group-data-closed/collapsible-content:slide-out-to-top-1',
  ),
  cn(
    'group-data-closed/collapsible-content:animation-duration-(--animation-duration)',
    'group-data-open/collapsible-content:animation-duration-(--animation-duration)',
  ),
)

function ToolFallbackContent({ className, children, ...props }: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent data-slot="tool-fallback-content" className={cn(contentClass, className)} {...props}>
      <div className={contentInnerClass}>{children}</div>
    </CollapsibleContent>
  )
}

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  argsText?: string
}) {
  if (!argsText) return null
  return (
    <div data-slot="tool-fallback-args" className={cn('aui-tool-fallback-args', className)} {...props}>
      <pre
        className={cn(
          'aui-tool-fallback-args-value bg-muted/50 text-foreground/90 rounded-md p-2.5',
          'text-xs break-words whitespace-pre-wrap',
        )}
      >
        {argsText}
      </pre>
    </div>
  )
}

const formatUnknownValue = (value: unknown, space?: number): string => {
  if (typeof value === 'string') return value
  try {
    if (value instanceof Error) return String(value)
    const json = JSON.stringify(value, null, space)
    if (json !== undefined) return json
  } catch {}
  try {
    return String(value)
  } catch {
    return '[Unserializable value]'
  }
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  result?: unknown
}) {
  if (result === undefined) return null
  return (
    <div data-slot="tool-fallback-result" className={cn('aui-tool-fallback-result', className)} {...props}>
      <p className="aui-tool-fallback-result-header text-muted-foreground text-xs font-medium">Result:</p>
      <pre
        className={cn(
          'aui-tool-fallback-result-content bg-muted/50 text-foreground/90 mt-1 rounded-md',
          'p-2.5 text-xs break-words whitespace-pre-wrap',
        )}
      >
        {formatUnknownValue(result, 2)}
      </pre>
    </div>
  )
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  status?: ToolCallMessagePartStatus
}) {
  if (status?.type !== 'incomplete') return null
  const error = status.error
  const errorText = error === undefined || error === null ? null : formatUnknownValue(error)
  if (!errorText) return null
  const isCancelled = status.reason === 'cancelled'
  const headerText = isCancelled ? 'Cancelled reason:' : 'Error:'
  return (
    <div data-slot="tool-fallback-error" className={cn('aui-tool-fallback-error', className)} {...props}>
      <p className="aui-tool-fallback-error-header text-muted-foreground font-semibold">{headerText}</p>
      <p className="aui-tool-fallback-error-reason text-muted-foreground break-words whitespace-pre-line">
        {errorText}
      </p>
    </div>
  )
}

export { formatUnknownValue, ToolFallbackContent, ToolFallbackArgs, ToolFallbackResult, ToolFallbackError }

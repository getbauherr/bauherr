'use client'

import { type ToolApprovalOption } from '@assistant-ui/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { approvalOptionLabel, isAllowKind, isKnownKind } from './tool-fallback-approval-model'
import { pressable } from './tool-fallback-questions'

export type ShellBase = {
  className: string | undefined
  divProps: React.ComponentPropsWithoutRef<'div'>
  groupRef: React.RefCallback<HTMLDivElement>
}

const SHELL_VARIANTS = {
  default: { slot: 'tool-fallback-approval', cls: 'aui-tool-fallback-approval flex flex-col gap-2 pt-1' },
  wide: { slot: 'tool-fallback-approval', cls: 'aui-tool-fallback-approval flex flex-col gap-3 pt-1' },
  confirm: {
    slot: 'tool-fallback-approval-confirm',
    cls: 'aui-tool-fallback-approval-confirm flex flex-col gap-2 pt-1',
  },
}

export function ApprovalShell({
  variant,
  shell,
  children,
}: {
  variant: keyof typeof SHELL_VARIANTS
  shell: ShellBase
  children: React.ReactNode
}) {
  const { slot, cls } = SHELL_VARIANTS[variant]
  return (
    <div data-slot={slot} tabIndex={-1} className={cn(cls, shell.className)} {...shell.divProps} ref={shell.groupRef}>
      {children}
    </div>
  )
}

export function ApprovalPrompt({ prompt }: { prompt: string | undefined }) {
  if (!prompt) return null
  return <p className="aui-tool-fallback-approval-prompt text-foreground whitespace-pre-line">{prompt}</p>
}

export function ApprovalError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="aui-tool-fallback-approval-error text-destructive text-xs whitespace-pre-line">
      {error}
    </p>
  )
}

export function DismissButton({ locked, onClick }: { locked: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" className={pressable} onClick={onClick} disabled={locked}>
      Dismiss
    </Button>
  )
}

export function AnswerField({
  question,
  prompt,
  answer,
  locked,
  onChange,
  onSend,
  dismissButton,
}: {
  question: boolean
  prompt: string | undefined
  answer: string
  locked: boolean
  onChange: (value: string) => void
  onSend: () => void
  dismissButton: React.ReactNode
}) {
  return (
    <div className="aui-tool-fallback-approval-answer flex flex-col items-start gap-2">
      <Textarea
        value={answer}
        onChange={(event) => onChange(event.target.value)}
        disabled={locked}
        aria-label={question ? (prompt ?? 'Answer') : 'Note'}
        placeholder={question ? 'Type your answer' : 'Add a note to your decision'}
      />
      {question && (
        <div className="flex items-center gap-2">
          <Button size="sm" className={pressable} onClick={onSend} disabled={locked}>
            Send
          </Button>
          {dismissButton}
        </div>
      )}
    </div>
  )
}

function ConfirmGrants({ grants }: { grants: readonly string[] | undefined }) {
  if (!grants || grants.length === 0) return null
  return (
    <ul className="aui-tool-fallback-approval-confirm-grants flex flex-col gap-1">
      {grants.map((grant) => (
        <li key={grant}>
          <code className="aui-tool-fallback-approval-confirm-grant bg-muted rounded px-1.5 py-0.5 text-xs">
            {grant}
          </code>
        </li>
      ))}
    </ul>
  )
}

export function ConfirmView({
  shell,
  confirming,
  locked,
  onConfirm,
  onBack,
}: {
  shell: ShellBase
  confirming: ToolApprovalOption
  locked: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const confirmMeta = typeof confirming.confirm === 'object' ? confirming.confirm : undefined
  const confirmDescription = confirmMeta?.description ?? confirming.description
  return (
    <ApprovalShell variant="confirm" shell={shell}>
      <p className="aui-tool-fallback-approval-confirm-title font-semibold">
        {confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}
      </p>
      {confirmDescription && (
        <p className="aui-tool-fallback-approval-confirm-description text-muted-foreground whitespace-pre-line">
          {confirmDescription}
        </p>
      )}
      <ConfirmGrants grants={confirming.grants} />
      <div className="flex items-center gap-2">
        <Button size="sm" className={pressable} onClick={onConfirm} disabled={locked}>
          Confirm
        </Button>
        <Button size="sm" variant="outline" className={pressable} onClick={onBack} disabled={locked}>
          Back
        </Button>
      </div>
    </ApprovalShell>
  )
}

type ViewSlots = {
  shell: ShellBase
  prompt: React.ReactNode
  answerField: React.ReactNode
  errorNode: React.ReactNode
  locked: boolean
}

export function OptionsView({
  slots,
  options,
  question,
  acceptsText,
  onOption,
  onDeny,
  dismissButton,
}: {
  slots: ViewSlots
  options: readonly ToolApprovalOption[]
  question: boolean
  acceptsText: boolean
  onOption: (option: ToolApprovalOption) => void
  onDeny: () => void
  dismissButton: React.ReactNode
}) {
  const { locked } = slots
  const allowOptions = options.filter((option) => isAllowKind(option.kind))
  const customOptions = options.filter((option) => !isKnownKind(option.kind))
  const rejectOptions = options.filter((option) => isKnownKind(option.kind) && !isAllowKind(option.kind))
  return (
    <ApprovalShell variant="default" shell={slots.shell}>
      {slots.prompt}
      <div className="flex flex-wrap items-center gap-2">
        {[...allowOptions, ...customOptions, ...rejectOptions].map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option === allowOptions[0] ? 'default' : 'outline'}
            className={pressable}
            onClick={() => onOption(option)}
            disabled={locked}
          >
            {approvalOptionLabel(option)}
          </Button>
        ))}
        {rejectOptions.length === 0 && !question && (
          <Button size="sm" variant="outline" className={pressable} onClick={onDeny} disabled={locked}>
            Deny
          </Button>
        )}
        {!acceptsText && dismissButton}
      </div>
      {slots.answerField}
      {slots.errorNode}
    </ApprovalShell>
  )
}

export function QuestionView({
  slots,
  acceptsText,
  dismissButton,
}: {
  slots: ViewSlots
  acceptsText: boolean
  dismissButton: React.ReactNode
}) {
  return (
    <ApprovalShell variant="default" shell={slots.shell}>
      {slots.prompt}
      {slots.answerField}
      {!acceptsText && dismissButton && <div className="flex items-center gap-2">{dismissButton}</div>}
      {slots.errorNode}
    </ApprovalShell>
  )
}

export function DefaultView({ slots, onAllow, onDeny }: { slots: ViewSlots; onAllow: () => void; onDeny: () => void }) {
  const { locked } = slots
  return (
    <ApprovalShell variant="default" shell={slots.shell}>
      {slots.prompt}
      <div className="flex items-center gap-2">
        <Button size="sm" className={pressable} onClick={onAllow} disabled={locked}>
          Allow
        </Button>
        <Button size="sm" variant="outline" className={pressable} onClick={onDeny} disabled={locked}>
          Deny
        </Button>
      </div>
      {slots.answerField}
      {slots.errorNode}
    </ApprovalShell>
  )
}

export type { ViewSlots }

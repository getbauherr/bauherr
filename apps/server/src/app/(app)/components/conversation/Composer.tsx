'use client'

import { ComposerPrimitive } from '@assistant-ui/react'
import { ArrowUpIcon } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { ComposerAddAttachment, ComposerAttachments } from '../assistant-ui/elements/attachment.aui'
import { TooltipIconButton } from '../assistant-ui/elements/tooltip-icon-button'

type Props = {
  placeholder: string
  inputId?: string
  inputRef?: Ref<HTMLTextAreaElement>
  maxLength?: number
  sendable?: boolean
  describedBy?: string | undefined
  invalid?: boolean
  footer?: ReactNode
}

const FRAME = 'flex w-full flex-col gap-2 rounded-md border border-border bg-card p-2 data-[dragging=true]:bg-muted'

export function Composer(props: Props) {
  const { placeholder, inputId, inputRef, maxLength, sendable = true, describedBy, invalid, footer } = props
  return (
    <ComposerPrimitive.Root asChild>
      <div className="w-full">
      <ComposerPrimitive.AttachmentDropzone className={FRAME}>
        <ComposerAttachments />
        <ComposerPrimitive.Input
          id={inputId}
          ref={inputRef}
          rows={2}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-label={inputId ? undefined : placeholder}
          submitMode={sendable ? 'enter' : 'none'}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          className="max-h-48 min-h-12 w-full resize-none bg-transparent px-2 py-1 font-sans outline-none"
        />
        <div className="flex items-center justify-between">
          <ComposerAddAttachment />
          {footer}
          {sendable && (
            <ComposerPrimitive.Send asChild>
              <TooltipIconButton tooltip="Send" variant="default" className="size-7 rounded-full">
                <ArrowUpIcon className="size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Send>
          )}
        </div>
      </ComposerPrimitive.AttachmentDropzone>
      </div>
    </ComposerPrimitive.Root>
  )
}

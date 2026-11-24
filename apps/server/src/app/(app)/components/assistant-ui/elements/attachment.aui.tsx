'use client'

import { AttachmentPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react'
import { AlertCircleIcon, FileText, Loader2Icon, PlusIcon, XIcon } from 'lucide-react'
import type { FC } from 'react'
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AttachmentPreviewDialog } from './attachment-preview'
import { useAttachmentState } from './attachment-state'

const TILE = 'relative size-14 overflow-hidden rounded-md bg-muted outline-none ring-1 ring-inset ring-border'
const COVER = 'absolute inset-0 flex items-center justify-center bg-background/70'

const labelOf = (state: ReturnType<typeof useAttachmentState>): string => {
  const status = state.isError ? ', upload failed' : state.isUploading ? ', uploading' : ''
  return `${state.src ? `Preview ${state.name}` : `${state.typeLabel} attachment ${state.name}`}${status}`
}

const Tile: FC<{ state: ReturnType<typeof useAttachmentState> }> = ({ state }) => (
  <div
    className={cn(TILE, state.src ? 'cursor-zoom-in' : 'cursor-default', state.isError && 'ring-destructive/60')}
    role={state.src ? 'button' : 'group'}
    tabIndex={0}
    aria-label={labelOf(state)}
  >
    {state.src && state.isImage ? (
      <img src={state.src} alt="" className="size-full object-cover" />
    ) : (
      <FileText className="m-auto mt-4 size-6 text-muted-foreground" />
    )}
    {state.isUploading && (
      <div aria-hidden="true" className={COVER}>
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    )}
    {state.isError && (
      <div aria-hidden="true" className={COVER}>
        <AlertCircleIcon className="size-4 text-destructive" />
      </div>
    )}
  </div>
)

const AttachmentRemove: FC<{ name: string }> = ({ name }) => (
  <AttachmentPrimitive.Remove asChild>
    <TooltipIconButton
      tooltip={`Remove ${name}`}
      className="absolute end-1 top-1 size-5 rounded-full bg-black/50! text-white hover:bg-black/70! hover:text-white!"
      side="top"
    >
      <XIcon className="size-3 stroke-[2.5]" />
    </TooltipIconButton>
  </AttachmentPrimitive.Remove>
)

const AttachmentUI: FC = () => {
  const state = useAttachmentState()
  const sent = !state.isComposer && state.isImage
  return (
    <TooltipProvider>
      <Tooltip>
        <AttachmentPrimitive.Root className={cn('relative', sent && 'only:*:first:size-24')}>
          <AttachmentPreviewDialog src={state.src} name={state.name}>
            <TooltipTrigger asChild>
              <Tile state={state} />
            </TooltipTrigger>
          </AttachmentPreviewDialog>
          {state.isComposer && <AttachmentRemove name={state.name} />}
        </AttachmentPrimitive.Root>
        <TooltipContent side="top">
          <AttachmentPrimitive.Name />
          {state.errorMessage && <p role="alert">{state.errorMessage}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export const UserMessageAttachments: FC = () => (
  <div className="flex w-full flex-row justify-end gap-2 empty:hidden">
    <MessagePrimitive.Attachments>{() => <AttachmentUI />}</MessagePrimitive.Attachments>
  </div>
)

export const ComposerAttachments: FC = () => (
  <div className="flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
    <ComposerPrimitive.Attachments>{() => <AttachmentUI />}</ComposerPrimitive.Attachments>
  </div>
)

export const ComposerAddAttachment: FC = () => (
  <ComposerPrimitive.AddAttachment asChild>
    <TooltipIconButton
      type="button"
      tooltip="Add attachment"
      side="bottom"
      variant="ghost"
      size="icon"
      className="size-7 rounded-full text-muted-foreground hover:text-foreground"
      aria-label="Add attachment"
    >
      <PlusIcon className="size-4" />
    </TooltipIconButton>
  </ComposerPrimitive.AddAttachment>
)

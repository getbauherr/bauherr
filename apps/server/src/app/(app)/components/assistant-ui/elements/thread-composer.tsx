'use client'

import { ComposerAddAttachment, ComposerAttachments } from '@/components/assistant-ui/elements/attachment.aui'
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AuiIf, type AssistantState, ComposerPrimitive, useAuiState } from '@assistant-ui/react'
import { ArrowUpIcon, MicIcon, SquareIcon, PlayIcon } from 'lucide-react'
import { useContext, type FC } from 'react'
import { ThreadComponentsContext, shouldShowComposerResume } from './thread-context'

export const Composer: FC<{
  autoFocus: boolean
}> = ({ autoFocus }) => {
  const { placeholder = 'Send a message...' } = useContext(ThreadComponentsContext)
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="aui_composer-shell"
          className={cn(
            'border-foreground/10 focus-within:border-foreground/25',
            'data-[dragging=true]:border-ring flex w-full cursor-text flex-col gap-2',
            'rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding)',
            'transition-[border-color] data-[dragging=true]:border-dashed',
            'data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]',
          )}
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder={placeholder}
            className={cn(
              'aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48',
              'min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6',
              'outline-none',
            )}
            rows={1}
            autoFocus={autoFocus}
            enterKeyHint="send"
            aria-label="Message input"
          />
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  )
}
const ICON_BUTTON = 'size-7 rounded-full'

const DictateControls: FC = () => (
  <AuiIf condition={(s) => s.thread.capabilities.dictation}>
    <AuiIf condition={(s) => s.composer.dictation == null}>
      <ComposerPrimitive.Dictate asChild>
        <TooltipIconButton
          tooltip="Voice input"
          side="bottom"
          type="button"
          variant="ghost"
          size="icon"
          className={cn('aui-composer-dictate text-muted-foreground hover:text-foreground', ICON_BUTTON)}
          aria-label="Start voice input"
        >
          <MicIcon className="aui-composer-dictate-icon size-4" />
        </TooltipIconButton>
      </ComposerPrimitive.Dictate>
    </AuiIf>
    <AuiIf condition={(s) => s.composer.dictation != null}>
      <ComposerPrimitive.StopDictation asChild>
        <TooltipIconButton
          tooltip="Stop dictation"
          side="bottom"
          type="button"
          variant="ghost"
          size="icon"
          className={cn('aui-composer-stop-dictation text-destructive', ICON_BUTTON)}
          aria-label="Stop voice input"
        >
          <SquareIcon
            className={cn(
              'aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current',
              'motion-reduce:animate-none',
            )}
          />
        </TooltipIconButton>
      </ComposerPrimitive.StopDictation>
    </AuiIf>
  </AuiIf>
)

const showsSend = (s: AssistantState) =>
  (!s.composer.canCancel || (s.thread.voice !== undefined && s.composer.submission === undefined)) &&
  !shouldShowComposerResume(s)

const showsCancel = (s: AssistantState) =>
  s.composer.canCancel && (s.thread.voice === undefined || s.composer.submission !== undefined)

const SendControls: FC = () => (
  <>
    <AuiIf condition={showsSend}>
      <ComposerPrimitive.Send asChild>
        <TooltipIconButton
          tooltip="Send message"
          side="bottom"
          type="button"
          variant="default"
          size="icon"
          className={cn('aui-composer-send', ICON_BUTTON)}
          aria-label="Send message"
        >
          <ArrowUpIcon className="aui-composer-send-icon size-4" />
        </TooltipIconButton>
      </ComposerPrimitive.Send>
    </AuiIf>
    <AuiIf condition={shouldShowComposerResume}>
      <ComposerPrimitive.Resume asChild>
        <TooltipIconButton
          tooltip="Resume generating"
          side="bottom"
          type="button"
          variant="default"
          size="icon"
          className={cn('aui-composer-resume', ICON_BUTTON)}
          aria-label="Resume generating"
        >
          <PlayIcon className="aui-composer-resume-icon size-4" />
        </TooltipIconButton>
      </ComposerPrimitive.Resume>
    </AuiIf>
  </>
)

const CancelControl: FC = () => {
  const isSending = useAuiState(
    (s) => s.composer.submission !== undefined && !(s.thread.isRunning && s.thread.capabilities.cancel),
  )
  return (
    <AuiIf condition={showsCancel}>
      <ComposerPrimitive.Cancel asChild>
        <Button
          type="button"
          variant="default"
          size="icon"
          className={cn('aui-composer-cancel', ICON_BUTTON)}
          aria-label={isSending ? 'Cancel sending' : 'Stop generating'}
        >
          <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
        </Button>
      </ComposerPrimitive.Cancel>
    </AuiIf>
  )
}

export const ComposerAction: FC = () => {
  const { ComposerExtra } = useContext(ThreadComponentsContext)
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      {ComposerExtra ? (
        <div className="aui-composer-action-start flex items-center gap-1.5">
          <ComposerAddAttachment />
          <ComposerExtra />
        </div>
      ) : (
        <ComposerAddAttachment />
      )}
      <div className="flex items-center gap-1.5">
        <DictateControls />
        <SendControls />
        <CancelControl />
      </div>
    </div>
  )
}

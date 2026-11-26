'use client'

import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button'
import { cn } from '@/lib/utils'
import {
  ActionBarPrimitive,
  AuiIf,
  MessagePrimitive,
  type TextMessagePartComponent,
  useAuiState,
} from '@assistant-ui/react'
import { AudioLinesIcon, CheckIcon, CopyIcon, MicIcon, PhoneIcon } from 'lucide-react'
import { type FC } from 'react'

export type VoiceRunPosition = 'single' | 'start' | 'middle' | 'end'
export const useVoiceRunPosition = (): VoiceRunPosition =>
  useAuiState((s) => {
    const before = s.thread.messages[s.message.index - 1]?.metadata.modality === 'voice'
    const after = s.thread.messages[s.message.index + 1]?.metadata.modality === 'voice'
    if (before) return after ? 'middle' : 'end'
    return after ? 'start' : 'single'
  })
export const SpokenText: TextMessagePartComponent = ({ text }) => <p className="aui-spoken-message-text m-0">{text}</p>
export const SpokenMessage: FC = () => {
  const role = useAuiState((s) => s.message.role)
  const position = useVoiceRunPosition()
  const isSpeaking = useAuiState((s) => s.message.role === 'assistant' && s.message.status?.type === 'running')
  const opensExchange = position === 'start' || position === 'single'
  return (
    <MessagePrimitive.Root
      data-slot="aui_spoken-message-root"
      data-role={role}
      data-voice-run={position}
      className={cn(
        'aui-spoken-message bg-muted/40 mx-2 px-3 py-1.5 [contain-intrinsic-size:auto_48px] [content-visibility:auto]',
        position === 'single' && 'rounded-xl py-2',
        position === 'start' && 'rounded-t-xl pt-2',
        position === 'middle' && '-mt-6',
        position === 'end' && '-mt-6 rounded-b-xl pb-2',
      )}
    >
      {opensExchange && (
        <div
          data-slot="aui_spoken-exchange-header"
          className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"
        >
          <PhoneIcon className="size-3" aria-hidden />
          <span>Voice conversation</span>
        </div>
      )}
      <div
        data-slot="aui_spoken-message-content"
        className="text-foreground flex items-start gap-2 text-sm leading-relaxed"
      >
        <span className="text-muted-foreground mt-1 shrink-0" aria-hidden>
          {role === 'user' ? <MicIcon className="size-3.5" /> : <AudioLinesIcon className="size-3.5" />}
        </span>
        <span className="sr-only">{role === 'user' ? 'You said' : 'Assistant said'}</span>
        <div className="min-w-0 flex-1 wrap-break-word">
          <MessagePrimitive.Parts components={{ Text: SpokenText }} />
          {isSpeaking && (
            <span
              data-slot="aui_spoken-message-indicator"
              role="status"
              className="text-muted-foreground ms-1 animate-pulse font-sans"
              aria-label="Assistant is speaking"
            >
              ●
            </span>
          )}
        </div>
        <SpokenActionBar />
      </div>
    </MessagePrimitive.Root>
  )
}
export const SpokenActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="always"
      className="aui-spoken-action-bar text-muted-foreground flex shrink-0 gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" className="size-6">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  )
}

'use client'

import { Image as MessageImage } from '@/components/assistant-ui/elements/image'
import { MarkdownText } from '@/components/assistant-ui/elements/markdown-text'
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from '@/components/assistant-ui/elements/reasoning.aui'
import { ToolFallback } from '@/components/assistant-ui/elements/tool-fallback.aui'
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  ErrorPrimitive,
  MessagePrimitive,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react'
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  Loader2Icon,
  PlayIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react'
import { useContext, type ComponentType, type FC, type PropsWithChildren, type ReactNode } from 'react'
import {
  DefaultToolGroup,
  ThreadComponentsContext,
  messageGroupBy,
  reasoningDuration,
  taskAwareGroupBy,
  type ThreadComponents,
  type ThreadGroupPart,
} from './thread-context'
import { BranchPicker, MessageFile } from './thread-user'

export const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root
        className={cn(
          'aui-message-error-root group/error border-destructive bg-destructive/10',
          'text-destructive',
          'data-[run-state=in-progress]:border-border',
          'data-[run-state=in-progress]:bg-muted/40',
          'data-[run-state=in-progress]:text-muted-foreground mt-2 flex flex-wrap',
          'items-center gap-x-3 gap-y-2 rounded-md border p-3 text-sm',
          'data-[run-state=stale]:border-warn/40',
          'data-[run-state=stale]:bg-warn/10 data-[run-state=stale]:text-warn',
        )}
      >
        <TriangleAlertIcon className="hidden size-4 shrink-0 group-data-[run-state=stale]/error:block" />
        <Loader2Icon
          className={cn(
            'hidden size-4 shrink-0 animate-spin',
            'group-data-[run-state=in-progress]/error:block motion-reduce:animate-none',
          )}
        />
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2 min-w-0 flex-1" />
        <ActionBarPrimitive.Resume asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('h-7 gap-1.5 border-warn/40 bg-transparent hover:bg-warn/15', 'disabled:hidden ')}
          >
            <PlayIcon className="size-3.5" />
            Resume
          </Button>
        </ActionBarPrimitive.Resume>
        <ActionBarPrimitive.RefreshRun asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 disabled:hidden">
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        </ActionBarPrimitive.RefreshRun>
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  )
}
type Parts = Pick<ThreadComponents, 'ToolGroup' | 'ReasoningGroup' | 'TaskGroup' | 'Indicator'> & {
  ToolFallback: ToolCallMessagePartComponent
}

const ReasoningGroupView: FC<PropsWithChildren<{ group: ThreadGroupPart }>> = ({ group, children }) => {
  const running = group.status.type === 'running'
  return (
    <ReasoningRoot streaming={running}>
      <ReasoningTrigger active={running} duration={reasoningDuration(group.timing)} />
      <ReasoningContent aria-busy={running}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

const GroupView: FC<PropsWithChildren<{ part: ThreadGroupPart; parts: Parts }>> = ({ part, parts, children }) => {
  const { ToolGroup = DefaultToolGroup, ReasoningGroup = ReasoningGroupView, TaskGroup } = parts
  if (part.type === 'group-task') return TaskGroup ? <TaskGroup group={part} /> : null
  if (part.type === 'group-tool') return <ToolGroup group={part}>{children}</ToolGroup>
  if (part.type === 'group-reasoning') return <ReasoningGroup group={part}>{children}</ReasoningGroup>
  return <div data-slot="aui_chain-of-thought">{children}</div>
}

const WorkingIndicator: FC<{ Indicator: ComponentType | undefined }> = ({ Indicator }) =>
  Indicator ? (
    <Indicator />
  ) : (
    <span
      data-slot="aui_assistant-message-indicator"
      className="animate-pulse font-sans motion-reduce:animate-none"
      aria-label="Assistant is working"
    >
      {'●'}
    </span>
  )

type RenderedPart = MessagePrimitive.GroupedParts.RenderInfo['part']

const isGroupPart = (part: RenderedPart): part is ThreadGroupPart => part.type.startsWith('group-')

const PartView: FC<{ part: RenderedPart; parts: Parts; children: ReactNode }> = ({ part, parts, children }) => {
  if (isGroupPart(part)) {
    return (
      <GroupView part={part} parts={parts}>
        {children}
      </GroupView>
    )
  }
  switch (part.type) {
    case 'text':
      return <MarkdownText />
    case 'reasoning':
      return <Reasoning {...part} />
    case 'tool-call':
      return part.toolUI ?? <parts.ToolFallback {...part} />
    case 'data':
      return part.dataRendererUI
    case 'file':
      return (
        <div data-slot="aui_assistant-message-file" className="py-1">
          <MessageFile {...part} />
        </div>
      )
    case 'image':
      return (
        <div data-slot="aui_assistant-message-image" className="py-1">
          <MessageImage {...part} />
        </div>
      )
    case 'indicator':
      return <WorkingIndicator Indicator={parts.Indicator} />
    default:
      return null
  }
}

export const AssistantMessage: FC = () => {
  const {
    Indicator,
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    TaskGroup,
  } = useContext(ThreadComponentsContext)
  const parts = { Indicator, ToolFallback: ToolFallbackComponent, ToolGroup, ReasoningGroup, TaskGroup }
  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className={cn(
        'fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150',
        '[contain-intrinsic-size:auto_200px] [content-visibility:auto]',
      )}
    >
      <div data-slot="aui_assistant-message-content" className="text-foreground px-2 leading-relaxed wrap-break-word">
        <MessagePrimitive.GroupedParts groupBy={TaskGroup ? taskAwareGroupBy : messageGroupBy}>
          {({ part, children }) => (
            <PartView part={part} parts={parts}>
              {children}
            </PartView>
          )}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>
      <div data-slot="aui_assistant-message-footer" className="ms-2 flex min-h-7.5 items-center pt-1.5">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  )
}

const FeedbackButtons: FC = () => (
  <AuiIf condition={(s) => s.thread.capabilities.feedback}>
    <ActionBarPrimitive.FeedbackPositive asChild>
      <TooltipIconButton
        tooltip="Helpful"
        className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground"
      >
        <ThumbsUpIcon />
      </TooltipIconButton>
    </ActionBarPrimitive.FeedbackPositive>
    <ActionBarPrimitive.FeedbackNegative asChild>
      <TooltipIconButton
        tooltip="Not helpful"
        className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground"
      >
        <ThumbsDownIcon />
      </TooltipIconButton>
    </ActionBarPrimitive.FeedbackNegative>
  </AuiIf>
)

const MORE_CONTENT = cn(
  'aui-action-bar-more-content bg-popover text-popover-foreground',
  'data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=open]:animate-in data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  'z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5',
)

const MORE_ITEM = cn(
  'aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground',
  'focus:bg-accent focus:text-accent-foreground flex items-center gap-2 rounded-lg',
  'px-2.5 py-1.5 text-sm outline-none select-none',
)

const MoreMenu: FC = () => (
  <ActionBarMorePrimitive.Root>
    <ActionBarMorePrimitive.Trigger asChild>
      <TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent">
        <MoreHorizontalIcon />
      </TooltipIconButton>
    </ActionBarMorePrimitive.Trigger>
    <ActionBarMorePrimitive.Content side="bottom" align="start" sideOffset={6} className={MORE_CONTENT}>
      <ActionBarPrimitive.ExportMarkdown asChild>
        <ActionBarMorePrimitive.Item className={MORE_ITEM}>
          <DownloadIcon className="size-4" />
          Export as Markdown
        </ActionBarMorePrimitive.Item>
      </ActionBarPrimitive.ExportMarkdown>
    </ActionBarMorePrimitive.Content>
  </ActionBarMorePrimitive.Root>
)

export const AssistantActionBar: FC = () => (
  <ActionBarPrimitive.Root
    hideWhenRunning
    autohide="not-last"
    className={cn(
      'aui-assistant-action-bar-root text-muted-foreground animate-in fade-in',
      'col-start-3 row-start-2 -ms-1 flex gap-1 duration-200',
    )}
  >
    <ActionBarPrimitive.Copy asChild>
      <TooltipIconButton tooltip="Copy">
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        </AuiIf>
      </TooltipIconButton>
    </ActionBarPrimitive.Copy>
    <FeedbackButtons />
    <ActionBarPrimitive.Reload asChild>
      <TooltipIconButton tooltip="Refresh">
        <RefreshCwIcon />
      </TooltipIconButton>
    </ActionBarPrimitive.Reload>
    <MoreMenu />
  </ActionBarPrimitive.Root>
)

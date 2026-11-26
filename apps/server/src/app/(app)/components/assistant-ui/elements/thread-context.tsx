'use client'

import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from '@/components/assistant-ui/elements/tool-group.aui'
import {
  type AssistantState,
  groupPartByType,
  MessagePrimitive,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react'
import { createContext, useState, type ComponentType,
  type ReactNode, type FC, type PropsWithChildren } from 'react'

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart
export const DefaultToolGroup: FC<
  PropsWithChildren<{
    group: ThreadGroupPart
  }>
> = ({ group, children }) => {
  const [open, setOpen] = useState(false)
  return (
    <ToolGroupRoot variant="ghost" open={open || group.counts.requiresAction > 0} onOpenChange={setOpen}>
      <ToolGroupTrigger count={group.indices.length} active={group.status.type === 'running'} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  )
}
export const reasoningDuration = (timing: ThreadGroupPart['timing']) =>
  timing?.completedAt === undefined ? undefined : Math.round((timing.completedAt - timing.startedAt) / 1000)
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined
  Welcome?: ComponentType | undefined
  Indicator?: ComponentType | undefined
  ToolFallback?: ToolCallMessagePartComponent | undefined
  ToolGroup?:
    | ComponentType<
        PropsWithChildren<{
          group: ThreadGroupPart
        }>
      >
    | undefined
  ReasoningGroup?:
    | ComponentType<
        PropsWithChildren<{
          group: ThreadGroupPart
        }>
      >
    | undefined
  TaskGroup?:
    | ComponentType<{
        group: ThreadGroupPart
      }>
    | undefined
  ComposerExtra?: ComponentType | undefined
  placeholder?: string | undefined
  composer?: boolean | undefined
  welcome?: ReactNode | undefined
  afterMessages?: ReactNode | undefined
  aboveComposer?: ReactNode | undefined
}
export const messageGroupBy = groupPartByType({
  reasoning: ['group-chainOfThought', 'group-reasoning'],
  'tool-call': ['group-chainOfThought', 'group-tool'],
  'standalone-tool-call': [],
})
export type ThreadGroupKey = 'group-chainOfThought' | 'group-reasoning' | 'group-tool' | 'group-task'
export const TASK_GROUP_PATH: readonly ThreadGroupKey[] = ['group-chainOfThought', 'group-task']
export const taskAwareGroupBy = (
  part: Parameters<typeof messageGroupBy>[0],
  context?: Parameters<typeof messageGroupBy>[1],
): readonly ThreadGroupKey[] => {
  const path = messageGroupBy(part, context)
  return part.type === 'tool-call' &&
    part.messages !== undefined &&
    path.length > 0 &&
    !context?.toolUIs?.[part.toolName]?.length
    ? TASK_GROUP_PATH
    : path
}
export const EMPTY_COMPONENTS: ThreadComponents = {}
export const ThreadComponentsContext = createContext<ThreadComponents>(EMPTY_COMPONENTS)
export const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading)
export const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 && s.thread.isLoading && !s.thread.isDisabled && !s.threads.isLoading
export const shouldShowComposerResume = (s: AssistantState) =>
  !!s.thread.canResume && s.composer.type === 'thread' && s.composer.isEmpty

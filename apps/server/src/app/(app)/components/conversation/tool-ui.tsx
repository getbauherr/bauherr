'use client'

import type { ToolCallMessagePartComponent } from '@assistant-ui/react'
import type { FC, PropsWithChildren } from 'react'
import { ToolFallback } from '../assistant-ui/elements/tool-fallback.aui'
import type { ThreadGroupPart } from '../assistant-ui/elements/thread-context'

export const withToolStates = <Args, Result>(
  render: ToolCallMessagePartComponent<Args, Result>,
): ToolCallMessagePartComponent<Args, Result> =>
  function ToolStates(props) {
    const failed = props.isError === true || props.status.type === 'incomplete'
    if (failed || props.status.type === 'running') return <ToolFallback {...props} />
    const Render = render
    return <Render {...props} />
  }

export const FlatToolGroup: FC<PropsWithChildren<{ group: ThreadGroupPart }>> = ({ children }) => (
  <div className="my-2 grid gap-3">{children}</div>
)

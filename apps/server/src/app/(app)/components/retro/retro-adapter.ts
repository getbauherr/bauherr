import type { ThreadMessageLike } from '@assistant-ui/react'
import type { Opening, Proposal } from '../../../../core/retro/schema'

export type RetroEntry = {
  id: string
  role: 'assistant' | 'owner'
  body: string
  proposals: Proposal[]
  opening: Opening | null
}

export type ProposeArgs = { retro: number; proposal: Proposal; accepted: boolean; titles: Record<number, string> }
export type FiguresArgs = { opening: Opening }

export const FIGURES_TOOL = 'retro_figures'
export const PROPOSE_TOOL = 'propose_change'

export const toThreadMessage =
  (retro: number, agreed: string[], titles: Record<number, string>) =>
  (entry: RetroEntry): ThreadMessageLike => {
    if (entry.role === 'owner') return { id: entry.id, role: 'user', content: [{ type: 'text', text: entry.body }] }
    const figures = entry.opening
      ? [
          {
            type: 'tool-call' as const,
            toolCallId: `${entry.id}-figures`,
            toolName: FIGURES_TOOL,
            args: { opening: entry.opening },
            result: 'shown',
          },
        ]
      : []
    const proposals = entry.proposals.map((proposal) => {
      const accepted = agreed.includes(proposal.id)
      const args: ProposeArgs = { retro, proposal, accepted, titles }
      return {
        type: 'tool-call' as const,
        toolCallId: `${entry.id}-${proposal.id}`,
        toolName: PROPOSE_TOOL,
        args,
        ...(accepted ? { result: 'accepted' } : {}),
      }
    })
    return {
      id: entry.id,
      role: 'assistant',
      status: { type: 'complete', reason: 'stop' },
      content: [...figures, { type: 'text', text: entry.body }, ...proposals],
    }
  }

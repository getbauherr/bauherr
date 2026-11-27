import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingDecisions, type Staged } from '../../src/app/(app)/components/inbox/use-pending-decisions'
import { proposalOf, stagedOf } from '../../src/app/(app)/lib/inbox-steer'
import { threadOf } from '../../src/app/(app)/lib/inbox-thread'
import type { ConversationMessage } from '../../src/core/conversations/store'
import { cardOf, refsOf, sourceOf } from '../helpers/ticket-source'

const target = { recordId: 126, number: 928 }
const drop = {
  kind: 'decide' as const,
  input: { recordId: 126, ask: 'question:agent', seq: 3, choice: 'drop-criteria', criteria: ['c3', 'c4'] },
}

const setup = (run: (s: Staged) => Promise<string | null> = () => Promise.resolve(null)) => {
  const deps = { run: vi.fn(run), notify: vi.fn(), onError: vi.fn(), onSettled: vi.fn(), delay: 6000 }
  return { deps, ...renderHook(() => usePendingDecisions(deps)) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('an intent from the composer', () => {
  it('stages a decision under the key of the decision card, with the drop receipt', () => {
    const staged = stagedOf(target, drop, 1)
    expect(staged).toMatchObject({ key: '126:question:agent:3', receipt: 'Dropped c3, c4', input: drop.input })
  })

  it('stages a comment under a key of its own', () => {
    const staged = stagedOf(target, { kind: 'comment', body: 'Skip emails.' }, 5)
    expect(staged).toMatchObject({ key: 'comment:126:5', comment: 'Skip emails.', receipt: 'Passed to the agent' })
  })

  it('stages nothing for an answer or a fallback', () => {
    expect(stagedOf(target, { kind: 'answer' }, 1)).toBeNull()
    expect(stagedOf(target, { kind: 'fallback', error: null }, 1)).toBeNull()
  })

  it('writes nothing before the toast runs out and nothing after an undo', async () => {
    const { deps, result } = setup()
    const staged = stagedOf(target, drop, 1)!
    act(() => result.current.stage(staged))
    expect(deps.run).not.toHaveBeenCalled()
    act(() => result.current.undo(staged.key))
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('commits the owner call when the toast runs out', async () => {
    const { deps, result } = setup()
    act(() => result.current.stage(stagedOf(target, drop, 1)!))
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(deps.run).toHaveBeenCalledTimes(1)
    expect(deps.run.mock.calls[0]?.[0].input).toEqual(drop.input)
  })
})

describe('a tool call from the model', () => {
  it('only yields a proposal: nothing is staged or written until the owner clicks', async () => {
    const { deps, result } = setup()
    const proposal = proposalOf(target, null, drop, 'p1')
    expect(proposal).toMatchObject({ kind: 'decide', input: drop.input })
    await act(() => vi.advanceTimersByTimeAsync(20_000))
    expect(result.current.staged).toEqual({})
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
    act(() => result.current.stage(stagedOf(target, drop, 1)!))
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it('makes no proposal for an answer or a fallback', () => {
    expect(proposalOf(target, null, { kind: 'answer' }, 'p1')).toBeNull()
  })

  it('reports an undo of a steered write so the thread can say so', () => {
    const onUndo = vi.fn()
    const deps = { run: vi.fn(), notify: vi.fn(), onError: vi.fn(), onSettled: vi.fn(), onUndo, delay: 6000 }
    const { result } = renderHook(() => usePendingDecisions(deps))
    const staged = stagedOf(target, drop, 1)!
    act(() => result.current.stage(staged))
    act(() => result.current.undo(staged.key))
    expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ steered: true }))
  })
})

describe('the thread after a reload', () => {
  it('shows the steering messages in time order with the comments', () => {
    const comments = [
      { id: 5, at: '2026-11-27T10:00:00.000Z', author: 'Me', role: 'bauherr' as const, text: 'Words', files: [] },
    ]
    const steer: ConversationMessage[] = [
      { id: 1, role: 'user', text: 'Why twice?', createdAt: '2026-11-27T09:00:00.000Z', files: [] },
      { id: 2, role: 'assistant', text: 'A draft.', createdAt: '2026-11-27T09:00:01.000Z', files: [] },
    ]
    const thread = threadOf(sourceOf(cardOf('brief', 'one-way-door', [], 2), { comments }), refsOf(), steer)
    expect(thread.messages.map((m) => m.id)).toEqual(['steer-1', 'steer-2', 'comment-5', `ask-${thread.decision?.key}`])
  })
})

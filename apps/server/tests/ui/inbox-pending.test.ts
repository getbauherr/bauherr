import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingDecisions, type Staged } from '../../src/app/(app)/components/inbox/use-pending-decisions'

const staged: Staged = {
  key: '126:brief:2',
  recordId: 126,
  number: 928,
  receipt: 'Brief approved',
  input: { choice: 'approve' },
}

const setup = (run: (s: Staged) => Promise<string | null> = () => Promise.resolve(null)) => {
  const deps = {
    run: vi.fn(run),
    notify: vi.fn(),
    onError: vi.fn(),
    onSettled: vi.fn(),
    delay: 6000,
  }
  return { deps, ...renderHook(() => usePendingDecisions(deps)) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('undo instead of confirmation', () => {
  it('shows the receipt and a toast at once but writes nothing yet', () => {
    const { deps, result } = setup()
    act(() => result.current.stage(staged))
    expect(result.current.staged[staged.key]).toEqual(staged)
    expect(deps.notify).toHaveBeenCalledTimes(1)
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('cancels before anything is written when undone', async () => {
    const { deps, result } = setup()
    act(() => result.current.stage(staged))
    act(() => result.current.undo(staged.key))
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(deps.run).not.toHaveBeenCalled()
    expect(result.current.staged).toEqual({})
  })

  it('commits once when the toast runs out and advances to the next ticket', async () => {
    const { deps, result } = setup()
    act(() => result.current.stage(staged))
    await act(() => vi.advanceTimersByTimeAsync(5_900))
    expect(deps.run).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(200))
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(deps.run).toHaveBeenCalledTimes(1)
    expect(deps.onSettled).toHaveBeenCalledWith(staged, true)
  })

  it('commits at once when the owner switches the thread, without advancing', async () => {
    const { deps, result } = setup()
    act(() => result.current.stage(staged))
    await act(async () => result.current.flush())
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(deps.run).toHaveBeenCalledTimes(1)
    expect(deps.onSettled).toHaveBeenCalledWith(staged, false)
  })

  it('commits when the owner leaves the page', async () => {
    const { deps, result, unmount } = setup()
    act(() => result.current.stage(staged))
    unmount()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it('brings the card back and says why when the factory refuses', async () => {
    const { deps, result } = setup(() => Promise.resolve('The ticket moved while this was open.'))
    act(() => result.current.stage(staged))
    await act(() => vi.advanceTimersByTimeAsync(6_100))
    expect(deps.onError).toHaveBeenCalledWith(staged, 'The ticket moved while this was open.')
    expect(result.current.staged).toEqual({})
  })
})

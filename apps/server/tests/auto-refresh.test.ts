import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** `AutoRefresh` run without a DOM: effects run at once, the document and fetch are stubs, time is faked. */
const h = vi.hoisted(() => ({ refresh: vi.fn(), cleanups: [] as (() => void)[] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('react', () => ({
  useRef: <T,>(v: T) => ({ current: v }),
  useTransition: () => [false, (f: () => void) => f()],
  useEffect: (f: () => void | (() => void)) => {
    const c = f()
    if (c) h.cleanups.push(c)
  },
}))

let visibility: 'visible' | 'hidden'
let version: number
let listeners: Record<string, () => void>
const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ v: version }) }))

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  version = 1
  listeners = {}
  fetchMock.mockClear()
  h.refresh.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('document', { get visibilityState() { return visibility }, addEventListener: (e: string, f: () => void) => (listeners[e] = f), removeEventListener: () => {} })
})
afterEach(() => {
  h.cleanups.splice(0).forEach((c) => c())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mount = async () => {
  const { AutoRefresh } = await import('../src/app/(app)/components/AutoRefresh')
  AutoRefresh({})
  await vi.advanceTimersByTimeAsync(0)
}

describe('AutoRefresh', () => {
  it('refreshes within 5 s of a change of `/api/changes` and not without one', async () => {
    await mount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.refresh).not.toHaveBeenCalled()
    version = 2
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('makes no request while the tab is hidden, and catches up when it shows again', async () => {
    visibility = 'hidden'
    await mount()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock).not.toHaveBeenCalled()
    visibility = 'visible'
    listeners.visibilitychange!()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a page mounted in a hidden tab refreshes at the first visible poll, once', async () => {
    visibility = 'hidden'
    await mount()
    visibility = 'visible'
    listeners.visibilitychange!()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })
})

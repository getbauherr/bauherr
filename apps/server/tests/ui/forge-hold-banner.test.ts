import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ForgeHoldBanner } from '../../src/app/(app)/components/factory/ForgeHoldBanner'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const START = new Date('2026-11-27T10:00:00Z')
const hold = { message: 'GitHub limit reached, resumes at 10:10 UTC', until: '2026-11-27T10:10:00.000Z' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  refresh.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the forge hold banner', () => {
  it('goes away by itself when the hold ends and refreshes the page once', () => {
    render(createElement(ForgeHoldBanner, { holds: [hold] }))
    expect(screen.queryByText(hold.message)).not.toBeNull()
    act(() => void vi.advanceTimersByTime(9 * 60_000))
    expect(screen.queryByText(hold.message)).not.toBeNull()
    act(() => void vi.advanceTimersByTime(60_000))
    expect(screen.queryByText(hold.message)).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not show a hold that already ended', () => {
    vi.setSystemTime(new Date('2026-11-27T10:20:00Z'))
    render(createElement(ForgeHoldBanner, { holds: [hold] }))
    expect(screen.queryByText(hold.message)).toBeNull()
  })
})

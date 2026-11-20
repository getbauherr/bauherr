import { describe, expect, it } from 'vitest'
import { startPool } from '../../src/jobs/runner/pool'

describe('the worker pool', () => {
  it('never works more runs at once than its limit and waits for them on stop', async () => {
    let active = 0
    let peak = 0
    let finished = 0
    const runOne = async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 30))
      active--
      finished++
    }
    const pool = startPool({ max: 2, intervalMs: 5, runOne })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await pool.stop()
    expect(peak).toBe(2)
    expect(active).toBe(0)
    expect(finished).toBeGreaterThan(2)
  })

  it('keeps going after a run throws', async () => {
    let calls = 0
    const quiet = () => undefined
    const original = console.error
    console.error = quiet
    const pool = startPool({
      max: 1,
      intervalMs: 5,
      runOne: () => (++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve()),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await pool.stop()
    console.error = original
    expect(calls).toBeGreaterThan(1)
  })
})

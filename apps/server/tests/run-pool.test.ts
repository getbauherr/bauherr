import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startRunPool } from '../src/lib/run-pool'

const job = () => {
  let done!: () => void
  let fail!: (e: Error) => void
  const p = new Promise<void>((res, rej) => ((done = res), (fail = rej)))
  return { p, done, fail }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.useRealTimers())

it('a short Run finishes while a long one is still running', async () => {
  const [long, short] = [job(), job()]
  const queue = [long, short]
  const finished: string[] = []
  const runOne = vi.fn(async () => {
    const j = queue.shift()
    if (!j) return
    await j.p
    finished.push(j === long ? 'long' : 'short')
  })
  const pool = startRunPool({ max: 2, intervalMs: 5000, runOne })
  await vi.advanceTimersByTimeAsync(5000)
  short.done()
  await vi.advanceTimersByTimeAsync(0)
  expect(finished).toEqual(['short'])
  long.done()
  await pool.stop()
  expect(finished).toEqual(['short', 'long'])
})

it('never exceeds max and refills a freed slot on the next tick', async () => {
  const jobs = [job(), job(), job()]
  let started = 0
  const runOne = vi.fn(() => jobs[started++].p)
  const pool = startRunPool({ max: 2, intervalMs: 5000, runOne })
  await vi.advanceTimersByTimeAsync(20000)
  expect(started).toBe(2)
  jobs[0].done()
  await vi.advanceTimersByTimeAsync(5000)
  expect(started).toBe(3)
  jobs.forEach((j) => j.done())
  await pool.stop()
})

it('a failing job frees its slot and stop() waits for in-flight jobs', async () => {
  const [bad, slow] = [job(), job()]
  const queue = [bad, slow]
  const runOne = vi.fn(() => queue.shift()?.p ?? Promise.resolve())
  const pool = startRunPool({ max: 2, intervalMs: 5000, runOne })
  bad.fail(new Error('boom'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(runOne.mock.calls.length).toBeGreaterThan(2)
  let stopped = false
  const stopping = pool.stop().then(() => (stopped = true))
  await vi.advanceTimersByTimeAsync(0)
  expect(stopped).toBe(false)
  slow.done()
  await stopping
  expect(stopped).toBe(true)
})

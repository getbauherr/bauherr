/** Ticks never wait for running jobs: each tick starts one `runOne` per free slot (at most `max` in flight). */
export const startRunPool = ({ max, intervalMs, runOne }: { max: number; intervalMs: number; runOne: () => Promise<unknown> }) => {
  let inFlight = 0
  const running = new Set<Promise<unknown>>()
  const tick = () => {
    for (; inFlight < max; inFlight++) {
      const p: Promise<unknown> = runOne()
        .catch((e) => console.error('run job failed', e))
        .finally(() => {
          inFlight--
          running.delete(p)
        })
      running.add(p)
    }
  }
  const timer = setInterval(tick, intervalMs)
  tick()
  return {
    async stop() {
      clearInterval(timer)
      await Promise.all(running)
    },
  }
}

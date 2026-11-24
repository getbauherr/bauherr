export type RunLink = { kind: 'session'; session: string } | { kind: 'run' }
export type CostRun = { id: number; link: RunLink; claimedAt: Date; endedAt: Date }

export type GatewayRequest = {
  at: Date
  cost: number | null
  inputTokens: number
  outputTokens: number
  session: string | null
  run: string | null
}

export type Measured = { costUsd: number | null; inputTokens: number; outputTokens: number }

const holds = (run: CostRun, session: string, at: number): boolean =>
  run.link.kind === 'session' &&
  run.link.session === session &&
  run.claimedAt.getTime() <= at &&
  at < run.endedAt.getTime()

const holders = (runs: CostRun[], request: GatewayRequest): CostRun[] => {
  if (request.run !== null) return runs.filter((run) => run.link.kind === 'run' && String(run.id) === request.run)
  if (request.session === null) return []
  const session = request.session
  return runs.filter((run) => holds(run, session, request.at.getTime()))
}

export const attribute = (runs: CostRun[], requests: GatewayRequest[]): Map<number, Measured> => {
  const measured = new Map<number, Measured>()
  const unpriced = new Set<number>()
  for (const request of requests) {
    const held = holders(runs, request)
    for (const run of held) {
      const share = 1 / held.length
      const before = measured.get(run.id) ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 }
      if (request.cost === null) unpriced.add(run.id)
      measured.set(run.id, {
        costUsd: (before.costUsd ?? 0) + (request.cost ?? 0) * share,
        inputTokens: before.inputTokens + request.inputTokens * share,
        outputTokens: before.outputTokens + request.outputTokens * share,
      })
    }
  }
  for (const id of unpriced) {
    const found = measured.get(id)
    if (found) measured.set(id, { ...found, costUsd: null })
  }
  return measured
}

export const outsideRuns = (runs: CostRun[], requests: GatewayRequest[]): Map<string, number> => {
  const days = new Map<string, number>()
  for (const request of requests) {
    if (request.run !== null || request.session === null || request.cost === null) continue
    if (holders(runs, request).length > 0) continue
    const day = request.at.toISOString().slice(0, 10)
    days.set(day, (days.get(day) ?? 0) + request.cost)
  }
  return days
}

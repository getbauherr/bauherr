export type Route = 'sub/*' | 'ws-*'
export type Period = 7 | 30 | 90
export type FailedRequest = { status: number; message: string; daysAgo: number; hour: number }
type Day = { runs: number; requests: number; failed: number; cost: number; accepted: number }
type Spec = {
  id: string
  model: string
  connection: string
  route: Route
  perDay: Day
  failures: Omit<FailedRequest, 'daysAgo' | 'hour'>[]
}
export type ProtoRow = {
  id: string
  model: string
  connection: string
  route: Route
  runs: number
  requests: number
  failed: number
  failedPct: number
  cost: number
  perAccepted: number | null
  share: number
  series: number[]
  failures: FailedRequest[]
}

export const PERIODS: Period[] = [7, 30, 90]
export const NOW = '2026-11-27T12:00:00Z'
export const BUDGET_PER_30_DAYS = 1500
export const PROTO_VARIANTS = ['a', 'b', 'c'] as const
export type ProtoVariant = (typeof PROTO_VARIANTS)[number]

const OVERLOADED = { status: 529, message: 'Overloaded: the upstream is at capacity, retry later' }
const RATE_LIMIT = { status: 429, message: 'Rate limit reached for the workspace key, retry after 20 s' }
const TIMEOUT = { status: 504, message: 'Upstream did not answer within 120 s' }
const CONTEXT = { status: 400, message: 'Prompt is too long: 214318 tokens > 200000 maximum' }
const UPSTREAM = { status: 500, message: 'Internal error at the provider, request id req_01H8Z2' }

const SPECS: Spec[] = [
  {
    id: 'opus',
    model: 'claude-opus-5-5',
    connection: 'Anthropic via gateway',
    route: 'sub/*',
    perDay: { runs: 9, requests: 310, failed: 6, cost: 21.4, accepted: 6 },
    failures: [OVERLOADED, CONTEXT, TIMEOUT],
  },
  {
    id: 'sonnet-sub',
    model: 'claude-sonnet-5-5',
    connection: 'Anthropic via gateway',
    route: 'sub/*',
    perDay: { runs: 26, requests: 980, failed: 14, cost: 12.8, accepted: 20 },
    failures: [OVERLOADED, RATE_LIMIT, UPSTREAM],
  },
  {
    id: 'sonnet-ws',
    model: 'claude-sonnet-5-5',
    connection: 'Anthropic via gateway',
    route: 'ws-*',
    perDay: { runs: 11, requests: 420, failed: 9, cost: 5.2, accepted: 8 },
    failures: [RATE_LIMIT, RATE_LIMIT, OVERLOADED],
  },
  {
    id: 'haiku',
    model: 'claude-haiku-5',
    connection: 'Anthropic via gateway',
    route: 'ws-*',
    perDay: { runs: 18, requests: 760, failed: 4, cost: 1.1, accepted: 11 },
    failures: [TIMEOUT, UPSTREAM],
  },
  {
    id: 'greenpt',
    model: 'greenpt-large',
    connection: 'GreenPT',
    route: 'ws-*',
    perDay: { runs: 7, requests: 240, failed: 26, cost: 0.9, accepted: 3 },
    failures: [
      { status: 400, message: 'response_format json_schema is not supported by this model' },
      TIMEOUT,
      UPSTREAM,
    ],
  },
  {
    id: 'oss',
    model: 'gpt-oss-120b',
    connection: 'OpenAI-compatible (vLLM)',
    route: 'ws-*',
    perDay: { runs: 5, requests: 170, failed: 11, cost: 0.4, accepted: 2 },
    failures: [CONTEXT, { status: 503, message: 'Model is loading, no replica is ready' }],
  },
  {
    id: 'qwen',
    model: 'qwen3-coder-480b',
    connection: 'OpenAI-compatible (OpenRouter)',
    route: 'ws-*',
    perDay: { runs: 6, requests: 205, failed: 8, cost: 1.9, accepted: 3 },
    failures: [RATE_LIMIT, { status: 502, message: 'Bad gateway from the routed provider' }],
  },
]

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const days = (spec: Spec, index: number): Day[] => {
  const next = rng(index * 7919 + 13)
  return Array.from({ length: 90 }, (_, age) => {
    const weekend = [0, 6].includes(new Date(Date.parse(NOW) - age * 864e5).getUTCDay())
    const load = (weekend ? 0.25 : 1.15) * (0.6 + next() * 0.8)
    const requests = Math.round(spec.perDay.requests * load)
    const failed = Math.round((requests * spec.perDay.failed * (0.4 + next() * 1.6)) / spec.perDay.requests)
    const runs = Math.round(spec.perDay.runs * load)
    return {
      runs,
      requests,
      failed,
      cost: Math.round(spec.perDay.cost * load * 100) / 100,
      accepted: Math.round(runs * (spec.perDay.accepted / spec.perDay.runs) * (0.7 + next() * 0.5)),
    }
  })
}

const sum = (list: Day[], key: keyof Day): number => list.reduce((total, day) => total + day[key], 0)

const failuresOf = (spec: Spec, index: number): FailedRequest[] => {
  const next = rng(index * 31 + 5)
  return spec.failures
    .flatMap((failure) => [failure, failure])
    .map((failure) => ({ ...failure, daysAgo: Math.floor(next() * 85), hour: 6 + Math.floor(next() * 14) }))
    .sort((a, b) => a.daysAgo - b.daysAgo || b.hour - a.hour)
}

export const protoRows = (period: Period): ProtoRow[] => {
  const rows = SPECS.map((spec, index) => {
    const all = days(spec, index)
    const window = all.slice(0, period)
    const cost = sum(window, 'cost')
    const accepted = sum(window, 'accepted')
    const requests = sum(window, 'requests')
    const failed = sum(window, 'failed')
    return {
      id: spec.id,
      model: spec.model,
      connection: spec.connection,
      route: spec.route,
      runs: sum(window, 'runs'),
      requests,
      failed,
      failedPct: requests === 0 ? 0 : (failed / requests) * 100,
      cost,
      perAccepted: accepted === 0 ? null : cost / accepted,
      share: 0,
      series: window.map((day) => day.cost).reverse(),
      failures: failuresOf(spec, index).filter((entry) => entry.daysAgo < period),
    }
  })
  const total = rows.reduce((acc, row) => acc + row.cost, 0)
  return rows.map((row) => ({ ...row, share: row.cost / total }))
}

export const protoTotals = (rows: ProtoRow[], period: Period) => {
  const cost = rows.reduce((acc, row) => acc + row.cost, 0)
  const requests = rows.reduce((acc, row) => acc + row.requests, 0)
  const failed = rows.reduce((acc, row) => acc + row.failed, 0)
  const accepted = SPECS.reduce((acc, spec, index) => acc + sum(days(spec, index).slice(0, period), 'accepted'), 0)
  return {
    cost,
    failedPct: (failed / requests) * 100,
    perAccepted: cost / accepted,
    budget: (BUDGET_PER_30_DAYS * period) / 30,
  }
}

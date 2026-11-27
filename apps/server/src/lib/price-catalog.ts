const MAX_RATE = 10_000
const SERVICE_TIERS = ['standard', 'flex', 'priority', 'reserved']
const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/
export const MIN_MODELS = 300
export const MIN_KEPT = 0.7
export const MAX_FACTOR = 10

type Rates = Partial<Record<(typeof RATE_KEYS)[number], string>> & { cacheWriteDetails?: Record<string, string> }
type Model = { name?: string; rates: Rates; tiers?: { contextOver?: number; serviceTier?: string; rates: Rates }[] }
export type Catalog = {
  metadata: { generatedAt: string }
  providers: Record<string, { models: Record<string, Model> }>
}
export type ListedModel = { provider: string; id: string; name: string; deprecated: boolean }
export type PriceChange = { model: string; input?: [string, string]; output?: [string, string] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const rate = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v)) return undefined
  const n = Number(v)
  return n <= MAX_RATE ? v : undefined
}

const ratesOf = (v: unknown): Rates | undefined => {
  if (!isObj(v)) return undefined
  const out: Rates = {}
  for (const k of RATE_KEYS) {
    const r = rate(v[k])
    if (r !== undefined) out[k] = r
  }
  if (out.input === undefined || out.output === undefined) return undefined
  if (isObj(v.cacheWriteDetails)) {
    const d = Object.fromEntries(
      Object.entries(v.cacheWriteDetails).filter(([k, x]) => (k === '1h' || k === '12h') && rate(x) !== undefined),
    ) as Record<string, string>
    if (Object.keys(d).length) out.cacheWriteDetails = d
  }
  return out
}

type Tier = NonNullable<Model['tiers']>[number]

const contextOverOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const serviceTierOf = (v: unknown): string | undefined =>
  typeof v === 'string' && SERVICE_TIERS.includes(v) ? v : undefined

const convertTier = (t: unknown): Tier[] => {
  if (!isObj(t)) return []
  const r = ratesOf(t.rates)
  const over = contextOverOf(t.contextOver)
  const svc = serviceTierOf(t.serviceTier)
  return r && (t.serviceTier === undefined ? over !== undefined : svc !== undefined)
    ? [{ ...(over !== undefined && { contextOver: over }), ...(svc && { serviceTier: svc }), rates: r }]
    : []
}

const convertProvider = (
  prov: string,
  models: Record<string, unknown>,
): { models: Record<string, Model>; list: ListedModel[] } => {
  const converted: Record<string, Model> = {}
  const list: ListedModel[] = []
  for (const [id, mv] of Object.entries(models)) {
    if (!NAME.test(id) || !isObj(mv)) continue
    const rates = ratesOf(mv.rates)
    if (!rates) continue
    const tiers = (Array.isArray(mv.tiers) ? mv.tiers : []).flatMap(convertTier)
    const name = typeof mv.name === 'string' ? mv.name.slice(0, 120) : id
    converted[id] = { name, rates, ...(tiers.length && { tiers }) }
    list.push({ provider: prov, id, name, deprecated: mv.status === 'deprecated' })
  }
  return { models: converted, list }
}

const generatedAtOf = (metadata: unknown): string =>
  isObj(metadata) && typeof metadata.generatedAt === 'string' ? metadata.generatedAt : ''

const checkedGeneratedAt = (metadata: unknown): string => {
  const generatedAt = generatedAtOf(metadata)
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('not a model catalog: "metadata.generatedAt" is missing')
  }
  return generatedAt
}

export const convertCatalog = (raw: unknown): { catalog: Catalog; list: ListedModel[] } => {
  if (!isObj(raw) || !isObj(raw.providers)) throw new Error('not a model catalog: "providers" is missing')
  const generatedAt = checkedGeneratedAt(raw.metadata)
  const providers: Catalog['providers'] = {}
  const list: ListedModel[] = []
  for (const [prov, pv] of Object.entries(raw.providers)) {
    if (!NAME.test(prov) || !isObj(pv) || !isObj(pv.models)) continue
    const converted = convertProvider(prov, pv.models)
    list.push(...converted.list)
    if (Object.keys(converted.models).length) providers[prov] = { models: converted.models }
  }
  return { catalog: { metadata: { generatedAt }, providers }, list }
}

const count = (c: Catalog): number => Object.values(c.providers).reduce((n, p) => n + Object.keys(p.models).length, 0)

const jumped = (a: number, b: number): boolean => a > 0 && b > 0 && (b / a > MAX_FACTOR || a / b > MAX_FACTOR)

const movedPrices = (prev: Catalog, next: Catalog): string[] => {
  const moved: string[] = []
  for (const [prov, p] of Object.entries(prev.providers)) {
    for (const [id, m] of Object.entries(p.models)) {
      const now = next.providers[prov]?.models[id]
      if (!now) continue
      for (const k of ['input', 'output'] as const) {
        if (jumped(Number(m.rates[k]), Number(now.rates[k]))) moved.push(`${prov}/${id}`)
      }
    }
  }
  return moved
}

export const refusal = (prev: Catalog | undefined, next: Catalog): string | null => {
  const n = count(next)
  if (n < MIN_MODELS) return `the catalog lists only ${n} models (minimum ${MIN_MODELS}); kept the previous prices`
  if (!prev) return null
  const was = count(prev)
  if (n < was * MIN_KEPT) return `the catalog dropped from ${was} to ${n} models; kept the previous prices`
  const moved = movedPrices(prev, next)
  const names = [...new Set(moved)].slice(0, 3).join(', ')
  return moved.length
    ? `prices moved by more than ${MAX_FACTOR}x for ${names}${moved.length > 3 ? ' and more' : ''}; ` +
        'kept the previous prices'
    : null
}
const FIRST_PARTY = ['anthropic', 'openai', 'gcp.gemini', 'mistral', 'xai', 'deepseek']
const rateOf = (c: Catalog | undefined, model: string): Rates | undefined => {
  const hits = Object.entries(c?.providers ?? {})
    .filter(([, p]) => p.models[model])
    .sort(([a], [b]) => (FIRST_PARTY.indexOf(a) + 1 || 99) - (FIRST_PARTY.indexOf(b) + 1 || 99))
  return hits[0]?.[1].models[model]?.rates
}

export const priceChanges = (prev: Catalog | undefined, next: Catalog, used: string[]): PriceChange[] =>
  used.flatMap((model) => {
    const a = rateOf(prev, model)
    const b = rateOf(next, model)
    if (!a || !b) return []
    const diff = (k: 'input' | 'output'): [string, string] | undefined =>
      Number(a[k]) !== Number(b[k]) ? [String(Number(a[k])), String(Number(b[k]))] : undefined
    const input = diff('input')
    const output = diff('output')
    return input || output ? [{ model, ...(input && { input }), ...(output && { output }) }] : []
  })

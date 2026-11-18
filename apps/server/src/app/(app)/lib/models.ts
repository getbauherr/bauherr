import type { Preset } from '../../../lib/providers'

const CATALOG_PROVIDER: Partial<Record<Preset, string>> = { anthropic: 'anthropic', openai: 'openai', gemini: 'gcp.gemini' }

export const modelOptions = (key: Preset, defaults: string[], listed: { provider: string; id: string; name: string; deprecated: boolean }[], current: string[]): (string | [string, string])[] | null => {
  const mine = listed.filter((m) => m.provider === CATALOG_PROVIDER[key])
  const known = new Map(mine.filter((m) => !m.deprecated).map((m) => [m.id, m.name]))
  const ids = [...new Set([...defaults, ...known.keys()])]
  const gone = [...new Set(current.filter((v) => v && mine.length && !ids.includes(v)))]
  const all = [...ids.map((id) => (known.get(id) && known.get(id) !== id ? ([id, `${known.get(id)} (${id})`] as [string, string]) : id)), ...gone.map((v) => [v, `${v} (no longer in the price catalog)`] as [string, string])]
  return all.length ? all : null
}


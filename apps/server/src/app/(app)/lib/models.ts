import type { Preset } from '../../../lib/providers'

/** The price catalog's provider id for the presets it lists models for. */
const CATALOG_PROVIDER: Partial<Record<Preset, string>> = { anthropic: 'anthropic', openai: 'openai', gemini: 'gcp.gemini' }

/**
 * Models offered for a tier: the preset's defaults plus every non-deprecated model the daily price refresh lists for the provider.
 * A model a tier already uses stays selectable when the catalog dropped it, marked as gone; the selection itself is never changed. Null (free text) when nothing is known.
 */
export const modelOptions = (key: Preset, defaults: string[], listed: { provider: string; id: string; name: string; deprecated: boolean }[], current: string[]): (string | [string, string])[] | null => {
  const mine = listed.filter((m) => m.provider === CATALOG_PROVIDER[key])
  const known = new Map(mine.filter((m) => !m.deprecated).map((m) => [m.id, m.name]))
  const ids = [...new Set([...defaults, ...known.keys()])]
  const gone = [...new Set(current.filter((v) => v && mine.length && !ids.includes(v)))]
  const all = [...ids.map((id) => (known.get(id) && known.get(id) !== id ? ([id, `${known.get(id)} (${id})`] as [string, string]) : id)), ...gone.map((v) => [v, `${v} (no longer in the price catalog)`] as [string, string])]
  return all.length ? all : null
}


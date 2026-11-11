import type { Payload } from 'payload'
import { parseDocument } from 'yaml'
import { tierModels } from '../../../lib/gateway'
import { PRESETS, presetOf } from '../../../lib/providers'
import type { ModelOption, RoleSettings } from '../components/team/types'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const
const TIERS = ['cheap', 'standard', 'strong']

/** Model choices of the role form: the Workspace's tiers with the model each maps to, then the models of every LLM Connection (its preset's models and the ones a tier uses). Values are `tier:<tier>` or `<connection>/<model>`. */
export const loadModelOptions = async (payload: Payload, workspace: number): Promise<ModelOption[]> => {
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, select: { slug: true, modelByTier: true }, ...o })) as Doc
  const conns = (await payload.find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } }, sort: 'id', pagination: false, select: { slug: true, name: true, config: true }, ...o })).docs as Doc[]
  const mapped = await tierModels(payload, { ...ws, id: workspace }).catch(() => ({}) as Record<string, string>)
  const bare = (v: string) => v.replace(`ws-${ws.slug}/`, '')
  const tiers = TIERS.filter((t) => mapped[t]).map((t) => ({ value: `tier:${t}`, label: `${t[0]!.toUpperCase()}${t.slice(1)} tier (${bare(mapped[t]!).split('/').slice(-1)[0]})`, group: 'Tier' }))
  const models = conns.filter((c) => c.config?.provider !== 'router').flatMap((c) => {
    const defaults = Object.values(PRESETS[presetOf(c.config)].defaultModels ?? {})
    const used = TIERS.flatMap((t) => (mapped[t] && bare(mapped[t]!).startsWith(`${c.slug}/`) ? [bare(mapped[t]!).slice(c.slug.length + 1)] : []))
    return [...new Set([...defaults, ...used])].map((m) => ({ value: `${c.slug}/${m}`, label: m, group: c.name as string }))
  })
  return [...tiers, ...models]
}

/** The factory file with one role's model and agent cap changed (comments and order kept). Throws when the role is not in the file. */
export const withRoleSettings = (yaml: string, roleId: string, s: RoleSettings): string => {
  const doc = parseDocument(yaml)
  const path = ['team', 'roles', roleId]
  if (!doc.hasIn(path)) throw new Error(`Role "${roleId}" is not in the factory file.`)
  if (s.model !== undefined) {
    for (const k of ['tier', 'provider', 'model']) doc.deleteIn([...path, k])
    if (s.model.startsWith('tier:')) doc.setIn([...path, 'tier'], s.model.slice(5))
    else {
      const slash = s.model.indexOf('/')
      doc.setIn([...path, 'provider'], s.model.slice(0, slash))
      doc.setIn([...path, 'model'], s.model.slice(slash + 1))
    }
  }
  if (s.agents === undefined) doc.deleteIn([...path, 'agents'])
  else doc.setIn([...path, 'agents'], s.agents)
  return String(doc)
}

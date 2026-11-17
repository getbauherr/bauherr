import type { TicketSource } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { latestWith } from '../app/(app)/lib/plan'
import { areaOf, type Feature, parseMap } from './feature-map'
import { read } from './knowledge'
import { ticketPaths } from './overlap'
import { forgeOf, id } from './release'
import { collectItem, type NoteItem } from './release-notes'
import { SUMMARY_MARKER } from './summary'
import type { noteTemplates } from './templates'

type Doc = Record<string, any>

export const mapLimit = async <T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!) } }))
  return out
}

const MAP_TTL_MS = 10 * 60_000
const LIMIT = 2000
const maps = new Map<string, { at: number; features: Feature[] | null }>()
const areas = new Map<string, string | null>()

const featuresOf = async (payload: Payload, productId: number | string, ctx: () => ReturnType<typeof forgeOf>): Promise<Feature[] | null> => {
  const hit = maps.get(String(productId))
  if (hit && Date.now() - hit.at < MAP_TTL_MS) return hit.features
  const { backend, repo } = await ctx()
  const product = (await payload.findByID({ collection: 'products', id: productId, depth: 0, overrideAccess: true })) as Doc
  const text = (await read(payload, id(product.workspace), 'feature-map.yaml', product.slug).catch(() => null))?.text
    ?? (await backend.forge.getFile(repo, 'docs/feature-map.yaml', (await backend.forge.getRepository(repo)).defaultBranch).then((f) => f.content, () => null))
  const features = text ? parseMap(text).features ?? null : null
  maps.set(String(productId), { at: Date.now(), features })
  return features
}

export const collectItems = async (payload: Payload, productId: number | string, tickets: Doc[], ts: TicketSource, summaryTpl?: Awaited<ReturnType<typeof noteTemplates>>['summary']): Promise<NoteItem[]> => {
  let ctx: ReturnType<typeof forgeOf> | undefined
  const forge = () => (ctx ??= forgeOf(payload, productId))
  const features = await featuresOf(payload, productId, forge)
  return mapLimit(tickets, async (t) => {
    const item = collectItem({ number: t.number, title: t.title, url: t.url, labels: t.labels ?? [] }, latestWith(await ts.listComments(String(t.number)), SUMMARY_MARKER)?.body ?? null, summaryTpl)
    if (!features) return item
    const key = t.mergeSha ? `${productId}:${t.mergeSha}` : null
    if (key && areas.has(key)) return { ...item, area: areas.get(key)! }
    const paths = await ticketPaths(payload, t, [])
    const area = areaOf(features, paths)
    if (key && paths.length) {
      if (areas.size >= LIMIT) areas.clear()
      areas.set(key, area)
    }
    return { ...item, area }
  })
}

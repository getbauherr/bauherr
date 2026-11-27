import type { Where } from 'payload'
import type { ForgeLimits } from '../../../core/forge/limits'
import { payloadClient } from './session'

const o = { overrideAccess: true, depth: 0 } as const

type AuditDoc = { id: number; at?: string; createdAt: string; kind?: string; actor?: string }

export async function loadAudit(workspace: number, f: { actor?: string }) {
  const where: Where = { workspace: { equals: workspace } }
  if (f.actor) where.actor = { like: f.actor.replace(/[\\%_]/g, '\\$&') }
  const { docs } = await (
    await payloadClient()
  ).find({ collection: 'human_touches', where, sort: '-createdAt', limit: 200, pagination: false, ...o })
  return (docs as AuditDoc[]).map((d) => ({
    id: d.id,
    at: d.at ?? d.createdAt,
    kind: d.kind ?? '',
    actor: d.actor ?? '',
  }))
}

type ConnectionDoc = { name: string; forgeLimits?: ForgeLimits | null }

type SourceDoc = { repo: string; lastPolledAt?: string | null; lastError?: string | null }

export async function loadHealth(workspace: number) {
  const payload = await payloadClient()
  const day = { greater_than_equal: new Date(Date.now() - 864e5).toISOString() }
  const count = async (where: Where) =>
    (await payload.count({ collection: 'payload-jobs', where: { createdAt: day, ...where }, ...o })).totalDocs
  const [queued, running, failed, oldest, sources, connections] = await Promise.all([
    count({ completedAt: { exists: false }, processing: { not_equals: true }, hasError: { not_equals: true } }),
    count({ processing: { equals: true }, completedAt: { exists: false } }),
    count({ hasError: { equals: true } }),
    payload.find({
      collection: 'payload-jobs',
      where: {
        createdAt: { greater_than_equal: new Date(Date.now() - 7 * 864e5).toISOString() },
        completedAt: { exists: false },
        processing: { not_equals: true },
        hasError: { not_equals: true },
      },
      sort: 'createdAt',
      limit: 1,
      pagination: false,
      select: { createdAt: true },
      ...o,
    }),
    payload.find({
      collection: 'ticket_sources',
      where: { workspace: { equals: workspace } },
      sort: 'id',
      pagination: false,
      select: { repo: true, lastPolledAt: true, lastError: true },
      ...o,
    }),
    payload.find({
      collection: 'connections',
      where: { workspace: { equals: workspace }, kind: { in: ['github', 'gitlab'] } },
      sort: 'id',
      pagination: false,
      select: { name: true, forgeLimits: true },
      ...o,
    }),
  ])
  return {
    queued,
    running,
    failed,
    oldestQueued: (oldest.docs[0] as { createdAt?: string } | undefined)?.createdAt ?? null,
    forges: (connections.docs as ConnectionDoc[]).map((c) => ({ name: c.name, limits: c.forgeLimits ?? {} })),
    sources: (sources.docs as SourceDoc[]).map((s) => ({
      repo: s.repo,
      polledAt: s.lastPolledAt ?? null,
      error: s.lastError ?? null,
    })),
  }
}

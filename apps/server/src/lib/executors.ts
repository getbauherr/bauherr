import type { Payload } from 'payload'
import type { TeamRole } from './sessions'

type Doc = Record<string, any>

/** The part of a workflow stage that decides who executes it. */
export type ExecutorStage = { name: string; kind: string; role?: string; gate?: string }
export type ExecutorFacts = {
  /** The stage's role, with its sessions: `working` on a Ticket in this stage, `idle`, and all not offline. */
  role?: { id: string; title: string; working: number; idle: number; connected: number }
  /** Tickets of the stage with a Run that waits for a session. */
  waiting: number
  /** The Product's CI deploy report: any deploy check configured, when the last deploy was reported, the CI's name and the settings page. */
  deploy: { configured: boolean; lastAt: string | null; ci: string; href: string }
  now: number
}
export type Executor = { line: string; action: { label: string; href: string } | null; /** Nobody can run the stage: the factory is stuck there when Tickets wait. */ cannotRun: boolean }

const minutes = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

/**
 * Who executes `stage`, as one true line with the one action that fixes it: a role with connected sessions, a role with none, the Product's CI (the release stage has no role by design),
 * the owner at a human gate, or no one. Null for stages that run nothing (done, container).
 */
export const executorOf = (stage: ExecutorStage, f: ExecutorFacts): Executor | null => {
  if (stage.kind === 'done' || stage.kind === 'container') return null
  if (stage.role && f.role) {
    const { title, working, idle, connected } = f.role
    if (connected > 0 || working > 0) return { line: `${title} · ${[working && `${working} working`, idle && `${idle} idle`].filter(Boolean).join(' · ') || `${connected} connected`}`, action: null, cannotRun: false }
    return { line: `${title} · none connected${f.waiting ? `, ${f.waiting} ${f.waiting === 1 ? 'Run' : 'Runs'} waiting` : ''}`, action: { label: `Connect a ${title}`, href: `/team?role=${encodeURIComponent(f.role.id)}` }, cannotRun: true }
  }
  if (stage.kind === 'release') {
    const d = f.deploy
    if (!d.configured) return { line: `${d.ci} · no deploy check configured`, action: { label: 'Configure deploy checks', href: d.href }, cannotRun: true }
    return { line: `${d.ci} · ${d.lastAt ? `last deploy ${minutes(f.now - Date.parse(d.lastAt))}` : 'no deploy reported yet'}`, action: null, cannotRun: false }
  }
  if (stage.gate === 'human' && !stage.role) return { line: 'You', action: null, cannotRun: false }
  return { line: 'No one assigned', action: { label: 'Edit workflow', href: '/workflow/edit' }, cannotRun: true }
}

/** Facts for every stage of a Workspace's workflow, from the database only (sessions by role, queued Runs, the Product's deploy settings and last release). */
export const executorsOf = async (payload: Payload, workspace: number | string, stages: ExecutorStage[], roles: TeamRole[], now = Date.now()): Promise<Map<string, Executor>> => {
  const o = { depth: 0, overrideAccess: true, pagination: false } as const
  const products = (await payload.find({ collection: 'products', where: { workspace: { equals: workspace } }, ...o })).docs as Doc[]
  const kind = ((await payload.find({ collection: 'connections', where: { and: [{ workspace: { equals: workspace } }, { kind: { in: ['github', 'gitlab'] } }] }, limit: 1, ...o })).docs[0] as Doc | undefined)?.kind
  const last = (await payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { releasedAt: { exists: true } }] }, sort: '-releasedAt', limit: 1, ...o })).docs[0] as Doc | undefined
  const waiting = (await payload.find({ collection: 'runs', where: { and: [{ workspace: { equals: workspace } }, { status: { equals: 'awaiting_session' } }] }, select: { stage: true }, ...o })).docs as Doc[]
  /** Observing CI with no names watches every check of the commit, so only a webhook Product without a URL has nothing configured. */
  const configured = (p: Doc) => !!String(p.deployChecks ?? '').trim() || !!p.deployWebhookUrl || p.deployMode !== 'webhook'
  const target = products.find((p) => !configured(p)) ?? products[0]
  const deploy = { configured: products.length > 0 && products.every(configured), lastAt: (last?.releasedAt as string | undefined) ?? null, ci: kind === 'gitlab' ? 'GitLab CI' : kind === 'github' ? 'GitHub Actions' : 'Product CI', href: target ? `/settings/products/${target.id}` : '/settings' }
  const out = new Map<string, Executor>()
  for (const s of stages) {
    const role = s.role ? roles.find((r) => r.id === s.role) : undefined
    const e = executorOf(s, {
      role: role && { id: role.id, title: role.title, working: role.sessions.filter((x) => x.status === 'working' && x.ticket?.stage === s.name).length, idle: role.sessions.filter((x) => x.status === 'idle').length, connected: role.sessions.filter((x) => x.status !== 'offline').length },
      waiting: waiting.filter((r) => r.stage === s.name).length,
      deploy,
      now,
    })
    if (e) out.set(s.name, e)
  }
  return out
}

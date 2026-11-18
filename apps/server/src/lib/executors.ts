import type { Payload } from 'payload'
import type { TeamRole } from './sessions'

type Doc = Record<string, any>

export type ExecutorStage = { name: string; kind: string; role?: string; gate?: string }
export type ExecutorFacts = {
  role?: { id: string; title: string; working: number; idle: number; connected: number }
  waiting: number
  deploy: { configured: boolean; lastAt: string | null; ci: string; href: string }
  now: number
}
export type Executor = { line: string; action: { label: string; href: string } | null; /** Nobody can run the stage: the factory is stuck there when Tickets wait. */ cannotRun: boolean; /** Why a Ticket of the stage waits, for its Who column (only when `cannotRun` and someone could be named). */ waits?: string }

export const DEPLOY_WAIT = "Waiting for the Product's deploy check"

const article = (title: string): string => `${/^[aeiou]/i.test(title) ? 'an' : 'a'} ${title}`

const minutes = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

export const executorOf = (stage: ExecutorStage, f: ExecutorFacts): Executor | null => {
  if (stage.kind === 'done' || stage.kind === 'container') return null
  if (stage.role && f.role) {
    const { title, working, idle, connected } = f.role
    if (connected > 0 || working > 0) return { line: `${title} · ${[working && `${working} working`, idle && `${idle} idle`].filter(Boolean).join(' · ') || `${connected} connected`}`, action: null, cannotRun: false }
    return { line: `${title} · none connected${f.waiting ? `, ${f.waiting} ${f.waiting === 1 ? 'Run' : 'Runs'} waiting` : ''}`, action: { label: `Connect ${article(title)}`, href: `/team?role=${encodeURIComponent(f.role.id)}` }, cannotRun: true, waits: `Waiting for ${article(title)} session` }
  }
  if (stage.kind === 'release') {
    const d = f.deploy
    if (!d.configured) return { line: `${d.ci} · no deploy check configured`, action: { label: 'Configure deploy checks', href: d.href }, cannotRun: true, waits: DEPLOY_WAIT }
    return { line: `${d.ci} · ${d.lastAt ? `last deploy ${minutes(f.now - Date.parse(d.lastAt))}` : 'no deploy reported yet'}`, action: null, cannotRun: false }
  }
  if (stage.gate === 'human' && !stage.role) return { line: 'You', action: null, cannotRun: false }
  return { line: 'No one assigned', action: { label: 'Edit workflow', href: '/workflow/edit' }, cannotRun: true }
}

export const waitingWho = (stageKind: string | undefined, e: Executor | undefined, t: { open: boolean; track: { releaseState?: string | null } }, s: { phase: string; who: string | null }): string | null => {
  if (!t.open || s.phase === 'working' || s.phase === 'done') return s.who
  if (stageKind === 'release' && t.track.releaseState === 'timed_out') return DEPLOY_WAIT
  if (s.phase === 'human') return s.who
  return e?.waits ?? s.who
}

export const executorsOf = async (payload: Payload, workspace: number | string, stages: ExecutorStage[], roles: TeamRole[], now = Date.now()): Promise<Map<string, Executor>> => {
  const o = { depth: 0, overrideAccess: true, pagination: false } as const
  const products = (await payload.find({ collection: 'products', where: { workspace: { equals: workspace } }, ...o })).docs as Doc[]
  const kind = ((await payload.find({ collection: 'connections', where: { and: [{ workspace: { equals: workspace } }, { kind: { in: ['github', 'gitlab'] } }] }, limit: 1, ...o })).docs[0] as Doc | undefined)?.kind
  const last = (await payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { releasedAt: { exists: true } }] }, sort: '-releasedAt', limit: 1, ...o })).docs[0] as Doc | undefined
  const waiting = (await payload.find({ collection: 'runs', where: { and: [{ workspace: { equals: workspace } }, { status: { equals: 'awaiting_session' } }] }, select: { stage: true }, ...o })).docs as Doc[]
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

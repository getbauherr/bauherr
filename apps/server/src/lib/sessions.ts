import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath, sep } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { sourceOf } from './actions'
import { workflowFor } from './factory'
import { ownsGate } from './gates'
import { tierModels } from './gateway'
import { record } from './history'
import { AGENT_REPAIRED, FINDING_FRESH_MS, type Cause } from './liveness'
import type { Ctx } from './mcp-tools'
import { id } from './release'
import { corePack, packDir, stage as stageDef, stagesOfRole, title as stageTitle, type Role, type Workflow } from './workflow'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

export const POLL_AFTER_SECONDS = 30
/** `lastSeenAt` is rewritten at most this often. */
const TOUCH_EVERY_S = 15
/** Disconnected sessions stay in `loadTeam` this long. */
const OFFLINE_KEEP_H = 24

/** Seconds of silence after which a session without a running Run is ended by `sweepSessions`. */
export const sessionTimeoutS = (): number => Number(process.env.BAUHERR_SESSION_TIMEOUT_S) || 600

const profiles = new Map<string, string>()
/** The role's profile text: inlined by an applied factory file, else read from the pack dir (a Workspace on the pack default still has `profile_file`). */
export const profileOf = (role: Role): string => {
  if (role.profile !== undefined) return role.profile
  if (!role.profile_file) return ''
  for (const dir of [packDir(), corePack()]) {
    const path = resolvePath(dir, role.profile_file)
    if (!path.startsWith(resolvePath(dir) + sep) || !existsSync(path)) continue
    if (!profiles.has(path)) profiles.set(path, readFileSync(path, 'utf8'))
    return profiles.get(path)!
  }
  return ''
}

const roleOfSession = (wf: Workflow, session: Doc): Role | undefined => wf.roles.find((r) => r.id === session.role)

/** The model a role names: its explicit provider and model, else the Workspace model of its tier; null when none can be resolved. */
const modelOf = async (payload: Payload, workspace: number | string, role: Role): Promise<{ model: string; provider?: string } | null> => {
  if (role.provider && role.model) return { model: role.model, provider: role.provider }
  if (!role.tier) return null
  try {
    const ws = await payload.findByID({ collection: 'workspaces', id: workspace, ...o })
    const [, provider, ...rest] = (await tierModels(payload, ws))[role.tier]?.split('/') ?? []
    return rest.length ? { model: rest.join('/'), provider } : null
  } catch {
    return null
  }
}

const missionOf = (profile?: string): string | undefined => /^Mission:\s*(.+)$/m.exec(profile ?? '')?.[1]

/** Loads a session of the caller by its public id; ended or unknown ones are a clear error (`allowEnded` for `disconnect`). */
export const resolve = async (c: Ctx, sessionId: unknown, allowEnded = false): Promise<Doc> => {
  const again = 'call connect again to start a new one'
  if (typeof sessionId !== 'string' || !sessionId) throw new Error(`sessionId must be a string; ${again}`)
  const row = (await c.payload.find({ collection: 'agent_sessions', where: { publicId: { equals: sessionId } }, limit: 1, ...o })).docs[0] as Doc | undefined
  if (!row || String(id(row.owner)) !== String(c.user.id)) throw new Error(`unknown session ${sessionId}; ${again}`)
  if (row.disconnectedAt && !allowEnded) throw new Error(`session ${sessionId} has ended (${row.endReason}); ${again}`)
  c.workspace = id(row.workspace)
  return row
}

/**
 * Presence: bumps `lastSeenAt` (skipped while it is younger than 15 s) and, with a `run` this session holds, keeps that Run's span: one span per (session, Run), opened at the claim (`startedAt` = the Run's start), `lastAt` extended by every touch for the Run.
 * `force` writes `lastAt` even inside the throttle window (the Run just ended). A Run that lost its lease keeps its last signal: nothing but a touch of the session extends a span.
 */
export const touch = async (payload: Payload, session: Doc, a: { run?: number | string; force?: boolean } = {}): Promise<void> => {
  const db = payload.db.drizzle
  const fresh = session.lastSeenAt && Date.now() - new Date(session.lastSeenAt).getTime() < TOUCH_EVERY_S * 1000
  if (!fresh) await db.execute(sql`UPDATE "agent_sessions" SET "last_seen_at" = now(), "updated_at" = now() WHERE "id" = ${session.id} AND "disconnected_at" IS NULL AND ("last_seen_at" IS NULL OR "last_seen_at" < now() - make_interval(secs => ${TOUCH_EVERY_S}))`)
  if (a.run == null) return
  const mine = sql`SELECT "id" FROM "session_spans" WHERE "session_id" = ${session.id} AND "run_id" = ${a.run}`
  await db.execute(sql`
    WITH ext AS (UPDATE "session_spans" SET "last_at" = now(), "updated_at" = now() WHERE "id" = (${mine} ORDER BY "started_at" DESC LIMIT 1) AND (${!!a.force} OR "last_at" < now() - make_interval(secs => ${TOUCH_EVERY_S})) RETURNING "id")
    INSERT INTO "session_spans" ("workspace_id", "session_id", "run_id", "ticket_id", "started_at", "last_at")
    SELECT "workspace_id", ${session.id}, "id", "ticket_id", COALESCE("started_at", now()), now() FROM "runs" WHERE "id" = ${a.run} AND "session_id" = ${session.id} AND NOT EXISTS (${mine})`)
}

/** Stamps a Run the session holds but did not claim with it (a legacy claim that now carries `sessionId`). */
export const stampRun = async (payload: Payload, session: Doc, runId: number | string): Promise<void> => {
  await payload.db.drizzle.execute(sql`UPDATE "runs" SET "session_id" = ${session.id}, "role" = COALESCE("role", ${session.role}), "updated_at" = now() WHERE "id" = ${runId} AND "status" = 'running' AND "session_id" IS NULL`)
}

type Who = { name: string | null; version: string | null; model: string | null; provider: string | null }

/**
 * Registers (or revives, by `session` = the client's stable key) a connected agent session for a role of the Workspace workflow and returns what it needs to start: the role's profile, its stages and the model it should use.
 * Reviving a row releases the Runs it still holds: the new process has no lease token for them.
 */
export const connect = async (c: Ctx, a: { role?: unknown; workspace?: unknown; session?: unknown; label?: unknown }, who: Who) => {
  const workspaces = (await c.payload.find({ collection: 'workspaces', pagination: false, depth: 0, overrideAccess: false, user: c.user as never, select: { slug: true } })).docs as Doc[]
  const ws = typeof a.workspace === 'string' ? workspaces.find((w) => w.slug === a.workspace) : workspaces.length === 1 ? workspaces[0] : undefined
  if (!ws) throw new Error(typeof a.workspace === 'string' ? `unknown workspace "${a.workspace}"; yours: ${workspaces.map((w) => w.slug).join(', ')}` : `pass workspace; yours: ${workspaces.map((w) => w.slug).join(', ')}`)
  const wf = workflowFor(ws.id)
  const role = wf.roles.find((r) => r.id === a.role)
  if (!role) throw new Error(`unknown role "${String(a.role)}"; valid roles: ${wf.roles.map((r) => `${r.id} (${r.title})`).join(', ')}`)
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const key = text(a.session, 64)
  const publicId = `ses_${randomBytes(9).toString('base64url')}`
  const label = text(a.label, 64) ?? key ?? `${role.id}-${publicId.slice(4, 8)}`
  const db = c.payload.db.drizzle
  const before = key ? ((await c.payload.find({ collection: 'agent_sessions', where: { and: [{ workspace: { equals: ws.id } }, { owner: { equals: c.user.id } }, { clientKey: { equals: key } }] }, limit: 1, ...o })).docs[0] as Doc | undefined) : undefined
  if (before) await releaseRuns(c, before)
  const row = (
    await db.execute(sql`
      INSERT INTO "agent_sessions" ("workspace_id", "public_id", "owner_id", "agent_key_id", "role", "label", "client_key", "client_name", "client_version", "provider", "model", "connected_at", "last_seen_at")
      VALUES (${ws.id}, ${publicId}, ${c.user.id}, ${c.actor.kind === 'agent' ? c.actor.keyId : null}, ${role.id}, ${label}, ${key}, ${who.name}, ${who.version}, ${who.provider}, ${who.model}, now(), now())
      ON CONFLICT ("workspace_id", "owner_id", "client_key") DO UPDATE SET "role" = EXCLUDED."role", "label" = EXCLUDED."label", "agent_key_id" = EXCLUDED."agent_key_id", "client_name" = EXCLUDED."client_name", "client_version" = EXCLUDED."client_version", "provider" = EXCLUDED."provider", "model" = EXCLUDED."model", "connected_at" = now(), "last_seen_at" = now(), "disconnected_at" = NULL, "end_reason" = NULL, "updated_at" = now()
      RETURNING "public_id"`)
  ).rows[0] as { public_id: string }
  c.workspace = ws.id
  const named = await modelOf(c.payload, ws.id, role)
  const modelHint =
    named && who.model !== named.model
      ? `This role runs on ${named.model}${named.provider ? ` (${named.provider})` : ''}. If you are not on it, do each Run's work in one subagent on that model if your client can; otherwise continue and the Run records the model you report.`
      : undefined
  return {
    sessionId: row.public_id,
    role: {
      id: role.id,
      title: role.title,
      skills: role.skills ?? [],
      profile: profileOf(role),
      stages: wf.stages.filter((s) => s.role === role.id).map((s) => ({ name: s.name, title: s.title, kind: s.kind, skill: s.skill, outcomes: s.outcomeOrder ?? Object.keys(s.outcomes) })),
      model: { ...(role.tier && { tier: role.tier }), ...(role.provider && { provider: role.provider }), ...(role.model && { model: role.model }) },
    },
    ...(modelHint && { modelHint }),
    usage: 'Report your token usage and cost: pass usage {tokensIn, tokensOut, cacheRead, cacheWrite, costUsd, model} (cumulative for the Run so far) to heartbeat and finish_run, unless the Bauherr usage hook is installed in your client (it reports for you).',
    pollAfterSeconds: POLL_AFTER_SECONDS,
    next: 'Call next_work with this sessionId.',
  }
}

/** What an agent may do about a stuck Ticket, by cause: only repairs that exist as agent tools today; owner decisions are never in the list. */
const allowedFor = (cause: Cause): { tool: string; args: string }[] => (AGENT_REPAIRED.includes(cause) ? [{ tool: 'return_to_build', args: '{ticket, reason}' }] : [])

const PROBLEMS: Partial<Record<Cause, string>> = {
  'mr-missing': 'the open MR was closed or is missing',
  'checks-red': 'required checks are red on the MR head',
  'run-failed': 'the last Run failed',
  'run-cancelled': 'the last Run was cancelled',
  'run-abandoned': 'the last Run lost its lease',
  'run-stuck': 'the last Run reported it was stuck',
  'review-escalated': 'the review is waiting for a decision',
  'review-invalid': 'the last review produced no valid verdict',
  'review-stalled': 'a clean review waits for a human merge',
  'triage-expired': 'the only Triage Run ended unclaimed',
}

/**
 * The next stuck Ticket of the Workspace for the exceptions role, from the findings the liveness sweep stores in `tickets.liveness` ({cause, need, at}; DB only, no forge call): one an agent can repair first, else the first one.
 * A finding older than `FINDING_FRESH_MS` means the sweep is not keeping up and is ignored. The finding has no time the Ticket got stuck, so `since` is the Ticket's last update.
 */
const exception = async (c: Ctx, wsId: number | string) => {
  const found = (await c.payload.db.drizzle.execute(sql`SELECT "id", "number", "title", "stage", "url", "updated_at", "liveness" FROM "tickets" WHERE "workspace_id" = ${wsId} AND "state" = 'open' AND "liveness" IS NOT NULL ORDER BY "id"`)).rows as Doc[]
  const fresh = found.filter((t) => Date.now() - Date.parse(t.liveness.at) < FINDING_FRESH_MS)
  const d = fresh.find((t) => AGENT_REPAIRED.includes(t.liveness.cause)) ?? fresh[0]
  if (!d) return null
  const cause = d.liveness.cause as Cause
  const allowed = allowedFor(cause)
  return {
    ticket: { id: d.id, number: Number(d.number), title: d.title, stage: d.stage, url: d.url },
    problem: `${PROBLEMS[cause] ?? cause} (${cause})`,
    since: new Date(d.updated_at).toISOString(),
    allowed,
    ...(!allowed.length && { note: 'No agent repair exists for this cause: it is the owner\'s to decide or the factory repairs it itself. Do not work around it.' }),
  }
}

/**
 * Presence check-in plus claim: the next Run of a stage the session's role works, through the same claim path as `claim_next` (`claimNext`), respecting the role's `agents` cap.
 * An exceptions role with nothing normal to claim gets the next stuck Ticket.
 */
export const nextWork = async (c: Ctx, claimNext: (a: { stages: string[] }) => Promise<Doc | null>) => {
  const session = c.session!
  const wsId = id(session.workspace)
  const wf = workflowFor(wsId)
  const role = roleOfSession(wf, session)
  if (!role) throw new Error(`role "${session.role}" is not in the Workspace workflow any more; call connect again`)
  const none = (reason: string, extra: Doc = {}) => ({ work: null, ...extra, reason, pollAfterSeconds: POLL_AFTER_SECONDS })
  const db = c.payload.db.drizzle
  const held = (await db.execute(sql`SELECT "id" FROM "runs" WHERE "session_id" = ${session.id} AND "status" = 'running' LIMIT 1`)).rows[0] as { id: number } | undefined
  if (held) return none(`You still hold Run ${held.id}: finish_run or release_run it first`)
  if (role.agents) {
    const running = (await db.execute(sql`SELECT count(*)::int AS n FROM "runs" WHERE "workspace_id" = ${wsId} AND "role" = ${role.id} AND "mode" = 'session' AND "status" = 'running'`)).rows[0] as { n: number }
    if (running.n >= role.agents) return none(`${role.title} is at its limit of ${role.agents} agent${role.agents === 1 ? '' : 's'}`)
  }
  const stages = stagesOfRole(wf, role.id)
  const claimed = stages.length ? await claimNext({ stages }) : null
  if (claimed) {
    const def = stageDef(wf, claimed.run.stage)
    const mission = missionOf(profileOf(role))
    return { work: { ...claimed, skill: def?.skill, outcomes: def?.outcomeOrder ?? Object.keys(def?.outcomes ?? {}), roleReminder: `You work as ${role.title} (${role.id}).${mission ? ` Mission: ${mission}` : ''} Stay in this role.` } }
  }
  if (role.exceptions) {
    const found = await exception(c, wsId)
    if (found) return none('Nothing queued; a stuck Ticket needs attention', { exception: found })
  }
  if (!stages.length) return none(`${role.title} has no stage in this workflow`)
  const waiting = await c.payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: wsId } }, { state: { equals: 'open' } }, { waitingFor: { in: stages } }] }, limit: 1, ...o })
  return none(waiting.docs[0] ? `${stageTitle(wf, waiting.docs[0].waitingFor)} is at its WIP limit` : `Nothing queued for ${role.title}`)
}

/** Puts the Runs a session still holds back in the queue (as `release_run` does without the token: the session is gone) and unassigns its login. */
const releaseRuns = async (c: Ctx, session: Doc): Promise<number> => {
  const rows = (await c.payload.db.drizzle.execute(sql`UPDATE "runs" SET "status" = 'awaiting_session', "session_owner_id" = NULL, "agent_key_id" = NULL, "lease_hash" = NULL, "heartbeat_at" = NULL, "session_id" = NULL, "updated_at" = now() WHERE "session_id" = ${session.id} AND "status" = 'running' RETURNING "id", "ticket_id"`)).rows as { id: number; ticket_id: number }[]
  const login = (c.user.githubLogin as string | undefined) ?? process.env.BAUHERR_BOT_LOGIN
  if (rows.length) await c.payload.db.drizzle.execute(sql`UPDATE "session_spans" SET "last_at" = now(), "updated_at" = now() WHERE "session_id" = ${session.id} AND "run_id" IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`)
  for (const r of rows) {
    try {
      const ticket = (await c.payload.findByID({ collection: 'tickets', id: r.ticket_id, ...o })) as Doc
      if (login && !(await ownsGate(c.payload, ticket, login))) {
        const { ts, n } = await sourceOf(c.payload, ticket)
        await ts.unassign(n, [login])
      }
      await record(c.payload, r.ticket_id, { run: r.id, actor: session.label, cause: 'run:released' })
    } catch (e) {
      c.payload.logger.warn({ err: e, run: r.id }, 'releasing a session Run: forge or history step failed')
    }
  }
  return rows.length
}

/** Ends the session and releases its running Runs. */
export const disconnect = async (c: Ctx, session: Doc) => {
  const ended = (await c.payload.db.drizzle.execute(sql`UPDATE "agent_sessions" SET "disconnected_at" = now(), "end_reason" = 'disconnect', "updated_at" = now() WHERE "id" = ${session.id} AND "disconnected_at" IS NULL RETURNING "id"`)).rows.length > 0
  return { sessionId: session.publicId, disconnected: true, released: ended ? await releaseRuns(c, session) : 0 }
}

/** Ends sessions with no running Run that were silent for `BAUHERR_SESSION_TIMEOUT_S` (default 600). A Run whose lease expired is abandoned by the lease sweep first; the rule then applies to its session. Returns how many it ended. */
export const sweepSessions = async (payload: Payload): Promise<number> =>
  (await payload.db.drizzle.execute(sql`UPDATE "agent_sessions" s SET "disconnected_at" = now(), "end_reason" = 'timeout', "updated_at" = now() WHERE s."disconnected_at" IS NULL AND s."last_seen_at" < now() - make_interval(secs => ${sessionTimeoutS()}) AND NOT EXISTS (SELECT 1 FROM "runs" r WHERE r."session_id" = s."id" AND r."status" = 'running') RETURNING s."id"`)).rows.length

export type TeamSession = {
  publicId: string
  label: string | null
  clientName: string | null
  clientVersion: string | null
  model: string | null
  provider: string | null
  status: 'working' | 'idle' | 'offline'
  ticket?: { number: number; title: string; stage: string }
  run?: number
  connectedAt: string | null
  lastSeenAt: string | null
  activeSecondsToday: number
  activeSecondsTotal: number
}
export type TeamRole = {
  id: string
  title: string
  avatar: string
  skills: string[]
  profile: string
  tier?: string
  provider?: string
  model?: string
  agents?: number
  exceptions: boolean
  stages: { name: string; title: string; kind: string }[]
  sessions: TeamSession[]
  autonomous: { run: number; executor: 'runner' | 'ci' | null; ticket: { number: number; title: string; stage: string }; startedAt: string | null; model: string | null }[]
}

/** DB-only read for the Team page: every role of the Workspace workflow with its sessions (connected ones and those disconnected in the last 24 h) and the autonomous Runs working for it right now. Sessions whose role left the workflow are in `orphans`. */
export const loadTeam = async (payload: Payload, workspace: number | string): Promise<{ roles: TeamRole[]; orphans: (TeamSession & { role: string })[] }> => {
  const wf = workflowFor(workspace)
  const db = payload.db.drizzle
  const rows = (
    await db.execute(sql`
      SELECT s."public_id", s."role", s."label", s."client_name", s."client_version", s."model", s."provider", s."connected_at", s."last_seen_at", s."disconnected_at",
        r."id" AS "run_id", t."number", t."title", t."stage" AS "ticket_stage",
        COALESCE(sp."total", 0)::float8 AS "total", COALESCE(sp."today", 0)::float8 AS "today"
      FROM "agent_sessions" s
      LEFT JOIN LATERAL (SELECT "id", "ticket_id" FROM "runs" WHERE "session_id" = s."id" AND "status" = 'running' ORDER BY "started_at" DESC LIMIT 1) r ON true
      LEFT JOIN "tickets" t ON t."id" = r."ticket_id"
      LEFT JOIN (
        SELECT "session_id", sum(EXTRACT(EPOCH FROM ("last_at" - "started_at"))) AS "total", sum(GREATEST(0, EXTRACT(EPOCH FROM ("last_at" - GREATEST("started_at", date_trunc('day', now())))))) AS "today"
        FROM "session_spans" GROUP BY "session_id"
      ) sp ON sp."session_id" = s."id"
      WHERE s."workspace_id" = ${workspace} AND (s."disconnected_at" IS NULL OR s."disconnected_at" > now() - make_interval(hours => ${OFFLINE_KEEP_H}))
      ORDER BY s."connected_at"`)
  ).rows as Doc[]
  const auto = (await db.execute(sql`SELECT r."id", r."stage", r."started_at", r."model", r."executor", t."number", t."title", t."stage" AS "ticket_stage" FROM "runs" r JOIN "tickets" t ON t."id" = r."ticket_id" WHERE r."workspace_id" = ${workspace} AND r."status" = 'running' AND r."mode" = 'autonomous' ORDER BY r."started_at"`)).rows as Doc[]
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  const silent = Date.now() - sessionTimeoutS() * 1000
  const toSession = (r: Doc): TeamSession => ({
    publicId: r.public_id,
    label: r.label,
    clientName: r.client_name,
    clientVersion: r.client_version,
    model: r.model,
    provider: r.provider,
    status: r.run_id ? 'working' : r.disconnected_at || new Date(r.last_seen_at).getTime() < silent ? 'offline' : 'idle',
    ...(r.run_id && { run: r.run_id, ticket: { number: Number(r.number), title: r.title, stage: r.ticket_stage } }),
    connectedAt: iso(r.connected_at),
    lastSeenAt: iso(r.last_seen_at),
    activeSecondsToday: r.today,
    activeSecondsTotal: r.total,
  })
  const roleIds = wf.roles.map((r) => r.id)
  return {
    roles: wf.roles.map((role) => ({
      id: role.id,
      title: role.title,
      avatar: role.avatar ?? role.id,
      skills: role.skills ?? [],
      profile: profileOf(role),
      ...(role.tier && { tier: role.tier }),
      ...(role.provider && { provider: role.provider }),
      ...(role.model && { model: role.model }),
      ...(role.agents && { agents: role.agents }),
      exceptions: !!role.exceptions,
      stages: wf.stages.filter((s) => s.role === role.id).map((s) => ({ name: s.name, title: s.title, kind: s.kind })),
      sessions: rows.filter((r) => r.role === role.id).map(toSession),
      autonomous: auto.filter((r) => stageDef(wf, r.stage)?.role === role.id).map((r) => ({ run: r.id, executor: r.executor === 'ci' ? 'ci' : r.executor === 'runner' ? 'runner' : null, ticket: { number: Number(r.number), title: r.title, stage: r.ticket_stage }, startedAt: iso(r.started_at), model: r.model })),
    })),
    orphans: rows.filter((r) => !roleIds.includes(r.role)).map((r) => ({ ...toSession(r), role: r.role })),
  }
}

/** Active time of the Workspace's sessions since `since`: the sum of their span durations clipped to the window, per session and per role. */
export const sessionTime = async (payload: Payload, workspace: number | string, since: Date): Promise<{ sessions: { sessionId: string; role: string; seconds: number }[]; roles: { role: string; seconds: number }[] }> => {
  const rows = (
    await payload.db.drizzle.execute(sql`
      SELECT s."public_id", s."role", sum(GREATEST(0, EXTRACT(EPOCH FROM (p."last_at" - GREATEST(p."started_at", ${since.toISOString()}::timestamptz)))))::float8 AS "seconds"
      FROM "session_spans" p JOIN "agent_sessions" s ON s."id" = p."session_id"
      WHERE s."workspace_id" = ${workspace} AND p."last_at" > ${since.toISOString()}::timestamptz
      GROUP BY s."public_id", s."role" ORDER BY s."public_id"`)
  ).rows as { public_id: string; role: string; seconds: number }[]
  const roles = new Map<string, number>()
  for (const r of rows) roles.set(r.role, (roles.get(r.role) ?? 0) + r.seconds)
  return { sessions: rows.map((r) => ({ sessionId: r.public_id, role: r.role, seconds: r.seconds })), roles: [...roles].map(([role, seconds]) => ({ role, seconds })) }
}

/** Server `instructions` of the MCP handshake: what the factory is and the connect loop, with the roles of the caller's workflow. */
export const instructions = (wf: Workflow): string =>
  `Bauherr is a software factory: Tickets move through stages worked by a team of roles (${wf.roles.map((r) => `${r.id}: ${r.title}`).join('; ')}). Call connect first with the role you were started for, then loop next_work. Pass the returned sessionId on every call. Finish each Run with finish_run, call disconnect when you stop.`

import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { flow, type Flow, type Phase } from '../../../lib/history'
import { sessionTime } from '../../../lib/sessions'
import { board, byKind, is, title, type Workflow } from '../../../lib/workflow'
import { duration } from './format'

export const RANGES = [7, 30, 90] as const
export type PhaseKey = Exclude<Phase, 'closed'>
export const PHASES: { key: PhaseKey; label: string }[] = [
  { key: 'working', label: 'In progress' },
  { key: 'human', label: 'Waiting for you' },
  { key: 'ci', label: 'Waiting on CI' },
  { key: 'queued', label: 'Queued' },
]

export type StageTime = { stage: string; title: string; tickets: number; phases: Record<PhaseKey, number>; total: number }
export type Insights = {
  done: number
  leadMedianSec: number | null
  leadP85Sec: number | null
  cycleMedianSec: number | null
  /** Share of the done Tickets' time per phase, 0..1. */
  share: Record<PhaseKey, number>
  stages: StageTime[]
  bottleneck: { stage: string; title: string; phase: PhaseKey; sentence: string } | null
  throughput: { week: string; tickets: number }[]
}

const quantile = (xs: number[], q: number): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const at = (s.length - 1) * q
  const lo = Math.floor(at)
  return s[lo]! + (s[Math.ceil(at)]! - s[lo]!) * (at - lo)
}

/** What the slowest stage is slow at, in words. */
export const bottleneckSentence = (stageTitle: string, phase: PhaseKey, sec: number): string => {
  const d = duration(sec)
  return { queued: `Tickets wait ${d} for a ${stageTitle} slot`, human: `Tickets wait ${d} for you in ${stageTitle}`, ci: `Tickets wait ${d} on CI in ${stageTitle}`, working: `${stageTitle} takes ${d} of work per Ticket` }[phase]
}

/** The flow metrics of the Tickets that started in the last `days` days (`flow()`), shaped for the Insights page. */
export const loadInsights = async (payload: Payload, wf: Workflow, workspace: number, o: { days: number; product: number | null; now?: number }): Promise<Insights> => {
  const now = o.now ?? Date.now()
  const f: Flow = await flow(payload, workspace, { from: new Date(now - o.days * 864e5).toISOString(), to: new Date(now + 6e4).toISOString(), ...(o.product && { product: o.product }) })
  const done = f.tickets.filter((t) => t.leadTimeSec != null)
  const totals: Record<PhaseKey, number> = { working: 0, human: 0, ci: 0, queued: 0 }
  for (const t of done) for (const s of t.stages) if (s.phase !== 'closed') totals[s.phase] += s.seconds
  const all = Object.values(totals).reduce((a, b) => a + b, 0)
  const stages: StageTime[] = board(wf)
    .filter((s) => !is(wf, s, 'done'))
    .flatMap((stage) => {
      const x = f.stages.find((y) => y.stage === stage)
      if (!x) return []
      const phases = Object.fromEntries(PHASES.map((p) => [p.key, x.phases[p.key]?.medianSec ?? 0])) as Record<PhaseKey, number>
      return [{ stage, title: title(wf, stage), tickets: x.tickets, phases, total: Object.values(phases).reduce((a, b) => a + b, 0) }]
    })
  const worst = stages.reduce<StageTime | null>((a, s) => (s.total > (a?.total ?? 0) ? s : a), null)
  const phase = worst && PHASES.reduce((a, p) => (worst.phases[p.key] > worst.phases[a.key] ? p : a)).key
  return {
    done: done.length,
    leadMedianSec: quantile(done.map((t) => t.leadTimeSec!), 0.5),
    leadP85Sec: quantile(done.map((t) => t.leadTimeSec!), 0.85),
    cycleMedianSec: quantile(done.flatMap((t) => (t.cycleTimeSec != null ? [t.cycleTimeSec] : [])), 0.5),
    share: Object.fromEntries(PHASES.map((p) => [p.key, all ? totals[p.key] / all : 0])) as Record<PhaseKey, number>,
    stages,
    bottleneck: worst && phase ? { stage: worst.stage, title: worst.title, phase, sentence: bottleneckSentence(worst.title, phase, worst.phases[phase]) } : null,
    throughput: f.throughput,
  }
}

export type WipAge = { id: number; number: number; title: string; stage: string; since: string; seconds: number }

/** The ten open Tickets that have waited longest in their current stage (since the newest stage-change event, else their last update). */
export const wipAge = async (payload: Payload, wf: Workflow, workspace: number, product: number | null, now = Date.now()): Promise<WipAge[]> => {
  const rows = (await payload.db.drizzle.execute(sql`
    SELECT t."id", t."number", t."title", COALESCE(t."stage", ${board(wf)[0]}) AS "stage", COALESCE(e."at", t."updated_at") AS "since"
    FROM "tickets" t
    LEFT JOIN LATERAL (SELECT "at" FROM "ticket_events" WHERE "ticket_id" = t."id" AND "stage" IS NOT NULL AND COALESCE("cause", '') NOT LIKE 'skip:%' AND "from_stage" IS DISTINCT FROM "stage" ORDER BY "at" DESC, "id" DESC LIMIT 1) e ON true
    WHERE t."workspace_id" = ${workspace}::int AND t."state" = 'open' ${product ? sql`AND t."product_id" = ${product}::int` : sql``}
      AND COALESCE(t."stage", '') NOT IN (${byKind(wf, 'done')?.name ?? ''}, ${byKind(wf, 'container')?.name ?? ''})
    ORDER BY "since" ASC LIMIT 10`)).rows
  return rows.map((r) => ({ id: Number(r.id), number: Number(r.number), title: r.title as string, stage: r.stage as string, since: new Date(r.since as string).toISOString(), seconds: (now - +new Date(r.since as string)) / 1000 }))
}

export type TeamTime = {
  roles: { role: string; title: string; seconds: number; runs: number }[]
  sessions: { sessionId: string; label: string; role: string; roleTitle: string; seconds: number; connectedSeconds: number; utilisation: number | null; runs: number }[]
}

/** Per role and per session of the last `days` days: active time (`sessionTime`), Runs finished, and for sessions the share of their connected time spent on a Run (utilisation, 0..1). */
export const loadTeamTime = async (payload: Payload, wf: Workflow, workspace: number, days: number, now = Date.now()): Promise<TeamTime> => {
  const since = new Date(now - days * 864e5)
  const [time, rows, byRole] = await Promise.all([
    sessionTime(payload, workspace, since),
    payload.db.drizzle.execute(sql`
      SELECT s."public_id", s."role", s."label",
        GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(s."disconnected_at", ${new Date(now).toISOString()}::timestamptz) - GREATEST(s."connected_at", ${since.toISOString()}::timestamptz))))::float8 AS "connected",
        (SELECT count(*) FROM "runs" r WHERE r."session_id" = s."id" AND r."finished_at" >= ${since.toISOString()}::timestamptz)::int AS "runs"
      FROM "agent_sessions" s
      WHERE s."workspace_id" = ${workspace} AND (s."disconnected_at" IS NULL OR s."disconnected_at" > ${since.toISOString()}::timestamptz)
      ORDER BY s."connected_at"`).then((r) => r.rows as { public_id: string; role: string; label: string | null; connected: number; runs: number }[]),
    payload.db.drizzle.execute(sql`SELECT "role", count(*)::int AS "runs" FROM "runs" WHERE "workspace_id" = ${workspace} AND "role" IS NOT NULL AND "finished_at" >= ${since.toISOString()}::timestamptz GROUP BY "role"`).then((r) => r.rows as { role: string; runs: number }[]),
  ])
  const active = new Map(time.sessions.map((x) => [x.sessionId, x.seconds]))
  const titleOf = (id: string) => wf.roles.find((r) => r.id === id)?.title ?? id
  return {
    roles: wf.roles.map((r) => ({ role: r.id, title: r.title, seconds: time.roles.find((x) => x.role === r.id)?.seconds ?? 0, runs: byRole.find((x) => x.role === r.id)?.runs ?? 0 })).filter((r) => r.seconds > 0 || r.runs > 0),
    sessions: rows.map((r) => {
      const seconds = active.get(r.public_id) ?? 0
      return { sessionId: r.public_id, label: r.label ?? r.public_id, role: r.role, roleTitle: titleOf(r.role), seconds, connectedSeconds: r.connected, utilisation: r.connected > 0 ? Math.min(1, seconds / r.connected) : null, runs: r.runs }
    }),
  }
}

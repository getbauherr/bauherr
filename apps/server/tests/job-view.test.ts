import { describe, expect, it } from 'vitest'
import { chipsOf, jobTickets, layoutJobs, stageJobs } from '../src/app/(app)/lib/job-view'
import { jobRowsOf, type Visit } from '../src/app/(app)/lib/steps'
import { DEFAULT, stage } from '../src/lib/workflow'

const wf = DEFAULT()
const plan = stage(wf, 'plan')!

describe('stageJobs', () => {
  it('lists the Jobs of the shipped Plan stage with its approval last, by depth', () => {
    expect(stageJobs(plan).map(({ id, title, kind, depth, blocking }) => ({ id, title, kind, depth, blocking }))).toEqual([
      { id: 'plan', title: 'Plan', kind: 'agent', depth: 0, blocking: true },
      { id: 'ax-scan', title: 'AX scan', kind: 'agent', depth: 1, blocking: false },
      { id: 'approve', title: 'Approve', kind: 'human', depth: 2, blocking: true },
    ])
    expect(stageJobs(plan).at(-1)).toMatchObject({ by: 'bauherr', needs: ['plan', 'ax-scan'] })
  })

  it('gives a stage without Jobs its one own Job', () => {
    expect(stageJobs(stage(wf, 'build')!)).toMatchObject([{ id: 'build', title: 'Build', kind: 'agent', role: 'engineer', depth: 0 }])
  })
})

describe('jobTickets', () => {
  const row = (id: number, stage: string, needsYou: string | null = null, extra = {}) => ({ id, stage, open: true, parked: false, needsYou, ...extra }) as never
  const rows = [row(1, 'plan'), row(2, 'plan'), row(3, 'plan', 'Approve plan'), row(4, 'plan', null, { parked: true }), row(5, 'build')]
  const live = [{ ticket: 1, stage: 'plan', job: 'ax-scan' }, { ticket: 2, stage: 'plan', job: null }, { ticket: 4, stage: 'plan', job: 'ax-scan' }, { ticket: 5, stage: 'build', job: null }]

  it('counts a Ticket per Job it has a live Run in, the approval Job by the Tickets waiting for it; parked Tickets are not in a Job', () => {
    expect([...jobTickets(wf, rows, live).get('plan')!]).toEqual([['plan', [2]], ['ax-scan', [1]], ['approve', [3]]])
  })

  it('covers only stages with explicit Jobs unless one is asked for', () => {
    expect([...jobTickets(wf, rows, live).keys()]).toEqual(['plan', 'review', 'release'])
    expect([...jobTickets(wf, rows, live, 'build').get('build')!]).toEqual([['build', [5]]])
  })

  it('makes one chip per Job with the count', () => {
    expect(chipsOf(wf, jobTickets(wf, rows, live)).get('plan')).toEqual([{ id: 'plan', title: 'Plan', count: 1 }, { id: 'ax-scan', title: 'AX scan', count: 1 }, { id: 'approve', title: 'Approve', count: 1 }])
  })
})

describe('layoutJobs', () => {
  it('puts Jobs in columns by depth and draws a skip over a column along a dashed lane', () => {
    const L = layoutJobs(stageJobs(plan))
    expect([...L.nodes.values()].map((n) => n.x)).toEqual([2, 290, 578])
    expect(L.edges.map((e) => [e.key, e.skip])).toEqual([['plan>ax-scan', false], ['plan>approve', true], ['ax-scan>approve', false]])
    expect(L.edges.every((e) => e.segs.every(([a, b, c, d]) => (b === d && b < L.top) || L.gaps.some((g) => Math.min(a, c) >= g.x && Math.max(a, c) <= g.x + g.w)))).toBe(true)
  })
})

describe('jobRowsOf', () => {
  const at = '2026-11-17T10:00:00.000Z'
  const visit = (steps: Visit['steps'] = []) => ({ stage: 'plan', at, steps })
  const run = (extra: Record<string, unknown>) => ({ id: 7, stage: 'plan', job: null, status: 'succeeded', mode: 'autonomous', executor: 'runner', createdAt: '2026-11-17T10:05:00.000Z', startedAt: '2026-11-17T10:05:00.000Z', finishedAt: '2026-11-17T10:07:00.000Z', gatewayCostUsd: 0.5, costUsd: 0.5, ...extra })
  const o = { admin: true, now: Date.parse('2026-11-17T11:00:00.000Z') }

  it('reads status, executor, duration and cost from each Job Run and the reason from a skip', () => {
    const rows = jobRowsOf(wf, visit(), null, [run({}), run({ id: 8, job: 'ax-scan', status: 'failed', error: 'no repo' })], [], o)!
    expect(rows.map((r) => [r.id, r.status])).toEqual([['plan', 'done'], ['ax-scan', 'failed'], ['approve', 'pending']])
    expect(rows[0]).toMatchObject({ seconds: 120, run: { executor: 'Runner', usage: '$0.50' } })
    expect(rows[1]!.reason).toBe('no repo')
    const skipped = jobRowsOf(wf, visit(), null, [run({})], [{ stage: 'plan', at: '2026-11-17T10:08:00.000Z', reason: 'no security paths', job: 'ax-scan', title: 'Plan' }], o)!
    expect(skipped[1]).toMatchObject({ status: 'skipped', reason: 'no security paths' })
  })

  it('times a live Run to now, ignores Runs of other visits, and shows a Job nobody started only in the current visit', () => {
    const live = run({ id: 9, job: 'ax-scan', status: 'running', finishedAt: null, startedAt: '2026-11-17T10:30:00.000Z', createdAt: '2026-11-17T10:30:00.000Z' })
    expect(jobRowsOf(wf, visit(), null, [live], [], o)!.find((r) => r.id === 'ax-scan')).toMatchObject({ status: 'working', seconds: 1800 })
    expect(jobRowsOf(wf, visit(), '2026-11-17T10:06:00.000Z', [live], [], o)!.map((r) => r.id)).toEqual([])
  })

  it('shows the approval as waiting or decided, and nothing for a stage without Jobs', () => {
    const human = (decision: Visit['steps'][number]['decision']) => visit([{ phase: 'human', decision } as never])
    expect(jobRowsOf(wf, human(null), null, [], [], o)!.at(-1)).toMatchObject({ id: 'approve', status: 'waiting' })
    expect(jobRowsOf(wf, human({ what: 'approve plan', actor: 'a@b.c' }), '2026-11-17T12:00:00.000Z', [], [], o)!.at(-1)).toMatchObject({ status: 'done', reason: 'Decided: approve plan by a@b.c' })
    expect(jobRowsOf(wf, { stage: 'build', at, steps: [] }, null, [], [], o)).toBeUndefined()
  })
})

import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { askOwner, parkOnNeed } from '../../src/core/ask'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { questionsBody } from '../../src/core/intake/questions'
import type { Criterion, Decision, Finding, TicketRecord } from '../../src/core/record/schema'
import { advance } from '../../src/core/engine'
import { appendEvent, createRecord, readRecord, setRank } from '../../src/core/record/store'
import { claim, heartbeat } from '../../src/core/run/leases'
import { rememberContext } from '../../src/core/run/context'
import { storeStatement } from '../../src/core/statements'
import type { Engine } from './harness'
import { source } from './fixtures'
import { verifyRoundsTicket } from './verify-rounds-fixtures'
import { asked, begin, edit, mirrorSource, patch, toBrief, workOn } from './scenario'

export const TICKET_TITLES = {
  briefTitle: 'Brief with a decision for the tabs',
  briefAnswers: 'Large export needs earlier answers',
  resultReadonly: 'Result to read',
  questionRead: 'Question to read',
  intake: 'Intake waiting for the reporter',
  runSteps: 'Build with reported steps',
  adoptedWaiting: 'Adopted pull request waiting on its author',
  adoptedResult: 'Adopted pull request with a result',
  deployStalled: 'Deploy that did not finish',
  verifyRounds: 'Review rounds used up',
  parkedOnNeed: 'Build parked on a missing Connection',
} as const

export const POOL_SIZE = 3

export const POOL_TITLES = {
  briefApprove: 'Brief with a decision to approve',
  briefArchive: 'Brief to archive',
  resultSendBack: 'Result to send back',
  resultAccept: 'Result to accept',
  resultStale: 'Result decided twice',
  question: 'Question from the agent',
  questionBack: 'Question to send back to Brief',
  questionOwn: 'Question to answer in own words',
  briefComment: 'Brief to comment on',
} as const

export type TicketNames = Record<keyof typeof TICKET_TITLES, number> &
  Record<keyof typeof POOL_TITLES, number[]>

const criterion = (n: number, text: string, kind: Criterion['verify']['kind'], how: string): Criterion => ({
  id: `c${n}`,
  text,
  verify: { kind, how },
  status: 'open',
  proof: [],
})

const BRIEF_CRITERIA: Criterion[] = [
  criterion(1, 'A 200 MB export completes.', 'test', 'Run the export test'),
  criterion(2, 'Progress is shown while it runs.', 'screenshot', 'Screenshots of the page'),
  criterion(3, 'Existing small exports are unchanged.', 'test', 'Run the old tests'),
]

const STORAGE: Decision = {
  id: 'd1',
  question: 'Stream the file to disk or to object storage?',
  options: [
    { id: 'disk', label: 'Disk' },
    { id: 'object-storage', label: 'Object storage' },
  ],
  recommended: 'object-storage',
}

const FINDINGS: Finding[] = [
  {
    id: 'f1',
    axis: 'spec',
    text: 'Empty value skipped the rule.',
    evidence: { kind: 'test', pointer: 'year.test.ts: empty' },
    status: 'fixed',
  },
  {
    id: 'f2',
    axis: 'standards',
    text: 'Claimed duplicate rule.',
    evidence: { kind: 'repro', pointer: 'no reproduction' },
    status: 'invalid',
  },
]

const proofRow = z.object({ id: z.coerce.number() })

type Proof = { criterion: string; kind: string; body: string | null; url: string | null }

const addProof = async (e: Engine, id: number, { criterion, kind, body, url }: Proof) => {
  const { workspace } = await readRecord(e.db.payload, id)
  const inserted = await e.db.payload.db.drizzle.execute(sql`
    INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha", "body", "url",
      "updated_at", "created_at") VALUES (${workspace}, ${id}, ${criterion}, ${kind}, 'session', 'h', ${body}, ${url},
      now(), now()) RETURNING "id"`)
  return String(proofRow.parse(inserted.rows[0]).id)
}

const briefFields = (decisions: Decision[]): Partial<TicketRecord> => ({
  goal: 'Exports over 50 MB finish instead of timing out.',
  criteria: BRIEF_CRITERIA,
  outOfScope: ['New export formats.'],
  risk: { door: 'two-way', areas: ['export'], rollback: 'Revert the pull request.' },
  decisions,
  plan: { steps: ['Stream the export.', 'Show progress.'] },
})

const SETTLED: Decision = { ...STORAGE, answer: 'object-storage', by: 'factory', at: '2026-11-19T10:00:00Z' }

const resultOf = async (e: Engine, id: number) => {
  const output = await addProof(e, id, { criterion: 'c1', kind: 'output', body: 'export.test.ts: 1 passed', url: null })
  const shot = await addProof(e, id, {
    criterion: 'c2',
    kind: 'screenshot',
    body: null,
    url: 'https://example.com/shots/progress.png',
  })
  const old = await addProof(e, id, { criterion: 'c3', kind: 'output', body: 'legacy.test.ts: 12 passed', url: null })
  const proofs = [output, shot, old]
  const done = BRIEF_CRITERIA.map((c, i): Criterion => ({ ...c, status: 'met', proof: [proofs[i] ?? ''] }))
  await edit(e, id, 'verify', {
    criteria: done,
    findings: FINDINGS,
    result: {
      changes: [
        { text: 'The export streams in chunks.', tag: 'visible' },
        { text: 'The chunk size lives in one setting.', tag: 'internal' },
      ],
      walkthrough: ['The request starts a streamed export.', 'The page shows the progress.'],
      notVerified: ['Behaviour on imported legacy data.'],
      cost: { usd: 1.8, runs: 3, minutes: 41 },
    },
  })
}

const resultTicket = async (e: Engine, pr: number): Promise<number> => {
  const id = await toBrief(e, false)
  await edit(e, id, 'brief', briefFields([SETTLED]))
  await patch(e, id, pr)
  await workOn(e, id, 'verifier', { passed: true, patchId: `p${pr}`, headSha: `h${pr}` })
  await resultOf(e, id)
  return id
}

const deployStalledTicket = async (e: Engine, pr: number): Promise<number> => {
  const id = await toBrief(e, false)
  await edit(e, id, 'brief', briefFields([SETTLED]))
  const config = e.config
  e.config = { ...config, deployChecks: true, deployNames: ['deploy-staging'] }
  await patch(e, id, pr)
  await workOn(e, id, 'verifier', { passed: true, patchId: `p${pr}`, headSha: `h${pr}` })
  const data = { reason: 'failed' as const, checks: ['deploy-staging'] }
  await appendEvent(e.db.payload, id, { type: 'ship.deploy-stalled', data, actor: 'factory' })
  await advance(id, e.deps())
  e.config = config
  return id
}

const ADOPTED_AUTHOR = 'dev-sam'
const ADOPTED_FIRST = 70

const adoptedTicket = async (e: Engine, pr: number, passed: boolean): Promise<number> => {
  const input = {
    workspace: e.db.workspace,
    product: e.db.product,
    source: { ...source, number: 3000 + pr, adopted: { pr } },
    type: 'change' as const,
  }
  const { id } = await createRecord(e.db.payload, input)
  const data = { pr, headSha: `h${pr}`, patchId: `adopted:h${pr}` }
  await appendEvent(e.db.payload, id, { type: 'pull.adopted', data, actor: 'factory' })
  await advance(id, e.deps())
  await workOn(e, id, 'builder', { goal: 'Fix it', open: false })
  await edit(e, id, 'brief', briefFields([SETTLED]))
  await e.checks(id)
  await workOn(e, id, 'verifier', { passed, patchId: data.patchId, headSha: data.headSha })
  if (passed) await resultOf(e, id)
  return id
}

const claimed = async (e: Engine, id: number) => {
  await setRank(e.db.payload, id, -1000)
  const input = { workspace: e.db.workspace, role: 'builder', by: 'runner-seed', now: e.clock.now } as const
  const got = await claim(e.db.payload, input)
  await setRank(e.db.payload, id, 0)
  if (!got) throw new Error('no run queued')
  return got
}

const reportedSteps = async (e: Engine, id: number) => {
  const { run, token } = await claimed(e, id)
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000)
  const steps: [number, string][] = [
    [35, 'Started from record version 3.'],
    [26, 'Plan step 1 of 4: column labels moved to the language files.'],
    [4, 'Local checks passed: lint, build, 212 tests.'],
    [0, 'Plan step 3 of 4: screenshots of both report pages.'],
  ]
  for (const [minutes, step] of steps) await heartbeat(e.db.payload, run.id, token, { now: ago(minutes), step })
}

const questionTicket = async (e: Engine, id: number) => {
  const { run, token } = await claimed(e, id)
  const text = 'Which storage should the export use?'
  await askOwner(run.id, token, { text, options: ['Disk', 'Object storage'] }, e.deps())
}

const parkedTicket = async (e: Engine) => {
  const id = await toBrief(e, false)
  await claimed(e, id).then(({ run, token }) => parkOnNeed(run.id, token, 'AWS Connection', e.deps()))
  return id
}

const intakeTicket = async (e: Engine, item: (number: number, fields?: { title: string }) => Promise<number>) => {
  const id = await begin(e)
  await asked(e, id, 1)
  const { record } = await readRecord(e.db.payload, id)
  const itemId = await item(record.source.number, { title: TICKET_TITLES.intake })
  const questions = [{ text: 'Which report shows the wrong year?', suggested: 'The yearly CO2 balance PDF' }]
  const body = `${DISCLOSURE}\n\n${questionsBody(1, questions)}`
  await e.db.payload.db.drizzle.execute(sql`
    INSERT INTO "mirror_comments" ("workspace_id", "item_id", "forge_id", "author", "body", "forge_created_at",
      "updated_at", "created_at")
    VALUES (${e.db.workspace}, ${itemId}, 'c1', 'bauherr-bot', ${body}, now(), now(), now())`)
  return id
}

const EARLIER_ANSWERS = [
  'Uploads and generated files go to object storage, not local disk.',
  'No new export formats before the reporting rework.',
]

const RESULT_ANSWERS = ['Run the old export tests before the new ones.', EARLIER_ANSWERS[1] ?? '']

const answered = async (e: Engine, id: number, stages: string[], from: number, texts: string[]) => {
  for (const text of texts) await storeStatement(e.db.payload, from, { kind: 'answer', scope: 'product', text })
  const db = e.db.payload.db.drizzle
  const found = await db.execute(sql`SELECT "id" FROM "statements" WHERE "record_id" = ${from} ORDER BY "id"`)
  const statements = found.rows.map((row) => proofRow.parse(row).id)
  const agentsFile = { given: false, cut: false }
  for (const stage of stages) {
    const runs = await db.execute(sql`SELECT "id" FROM "stage_runs" WHERE "record_id" = ${id} AND "stage" = ${stage}`)
    for (const run of runs.rows) {
      await rememberContext(e.db.payload, proofRow.parse(run).id, { statements, similar: [], agentsFile })
    }
  }
}

const pooled = async (make: (n: number) => Promise<number>): Promise<number[]> => {
  const ids: number[] = []
  for (let n = 1; n <= POOL_SIZE; n++) ids.push(await make(n))
  return ids
}

export const seedTickets = async (e: Engine): Promise<TicketNames> => {
  const mirror = await mirrorSource(e)
  const titled: [number, string][] = []
  const open = async (title: string) => {
    const id = await toBrief(e, true)
    await edit(e, id, 'brief', briefFields([STORAGE]))
    titled.push([id, title])
    return id
  }
  const result = async (title: string, pr: number) => {
    const id = await resultTicket(e, pr)
    titled.push([id, title])
    return id
  }
  const asking = async (title: string) => {
    const id = await toBrief(e, false)
    await questionTicket(e, id)
    titled.push([id, title])
    return id
  }
  let pr = 10
  const names = {
    briefTitle: await open(TICKET_TITLES.briefTitle),
    briefAnswers: await open(TICKET_TITLES.briefAnswers),
    briefApprove: await pooled((n) => open(`${POOL_TITLES.briefApprove} ${n}`)),
    briefArchive: await pooled((n) => open(`${POOL_TITLES.briefArchive} ${n}`)),
    resultReadonly: await result(TICKET_TITLES.resultReadonly, ++pr),
    resultSendBack: await pooled((n) => result(`${POOL_TITLES.resultSendBack} ${n}`, ++pr)),
    resultAccept: await pooled((n) => result(`${POOL_TITLES.resultAccept} ${n}`, ++pr)),
    resultStale: await pooled((n) => result(`${POOL_TITLES.resultStale} ${n}`, ++pr)),
    question: await pooled((n) => asking(`${POOL_TITLES.question} ${n}`)),
    questionRead: await asking(TICKET_TITLES.questionRead),
    runSteps: await toBrief(e, false),
    parkedOnNeed: await parkedTicket(e),
  }
  titled.push([names.runSteps, TICKET_TITLES.runSteps])
  const deployStalled = await deployStalledTicket(e, ++pr)
  const verifyRounds = await verifyRoundsTicket(e, ++pr, briefFields([SETTLED]))
  titled.push([deployStalled, TICKET_TITLES.deployStalled], [verifyRounds, TICKET_TITLES.verifyRounds])
  titled.push([names.parkedOnNeed, TICKET_TITLES.parkedOnNeed])
  const briefComment = await pooled((n) => open(`${POOL_TITLES.briefComment} ${n}`))
  const adoptedWaiting = await adoptedTicket(e, ADOPTED_FIRST, false)
  const adoptedResult = await adoptedTicket(e, ADOPTED_FIRST + 1, true)
  titled.push([adoptedWaiting, TICKET_TITLES.adoptedWaiting], [adoptedResult, TICKET_TITLES.adoptedResult])
  await answered(e, names.briefAnswers, ['brief'], names.resultReadonly, EARLIER_ANSWERS)
  await answered(e, names.resultReadonly, ['build', 'verify'], names.briefTitle, RESULT_ANSWERS)
  await reportedSteps(e, names.runSteps)
  for (let n = 11; n <= pr; n++) await mirror.item(n, { kind: 'pr', head: `h${n}`, title: `Pull request ${n}` })
  for (const [id, title] of titled) {
    const { source } = (await readRecord(e.db.payload, id)).record
    await mirror.item(source.number, { title })
  }
  for (const [id, number] of [[adoptedWaiting, ADOPTED_FIRST], [adoptedResult, ADOPTED_FIRST + 1]] as const) {
    const closes = [(await readRecord(e.db.payload, id)).record.source.number]
    const title = `Pull request ${number}`
    await mirror.item(number, { kind: 'pr', head: `h${number}`, title, author: ADOPTED_AUTHOR, closes })
  }
  const closes = [3000 + ADOPTED_FIRST]
  const other = { kind: 'pr', head: 'h72', title: 'Another take on the fix', author: 'dev-lee', closes } as const
  await mirror.item(ADOPTED_FIRST + 2, { ...other, closes })
  const intake = await intakeTicket(e, mirror.item)
  const questionBack = await pooled((n) => asking(`${POOL_TITLES.questionBack} ${n}`))
  const questionOwn = await pooled((n) => asking(`${POOL_TITLES.questionOwn} ${n}`))
  for (const id of [...questionBack, ...questionOwn]) {
    const { source } = (await readRecord(e.db.payload, id)).record
    await mirror.item(source.number, { title: titled.find(([found]) => found === id)?.[1] ?? '' })
  }
  const waiting = { adoptedWaiting, adoptedResult, deployStalled, verifyRounds, intake }
  return { ...names, questionBack, questionOwn, briefComment, ...waiting }
}

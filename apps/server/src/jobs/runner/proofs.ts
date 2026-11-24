import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { sql } from '@payloadcms/db-postgres'
import { git, WORK_DIR } from '@bauherr/runner'
import { z } from 'zod'
import type { Conn } from '../../core/conn'
import type { Problem } from '../../core/module'
import { BODY_MAX } from '../../core/run/mcp/attach-proof'
import type { Checkout } from './plan'

const exec = promisify(execFile)

export const PROOFS_FILE = 'proofs.json'
export const COMMAND_TIMEOUT_MS = 5 * 60_000
const TIMED_OUT = 124
const FAILED = 1
const BUFFER_BYTES = 16 * 1024 * 1024

const entry = z.discriminatedUnion('kind', [
  z.strictObject({
    ref: z.string().trim().min(1),
    criterion: z.string().trim().min(1),
    kind: z.literal('command'),
    command: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({
    ref: z.string().trim().min(1),
    criterion: z.string().trim().min(1),
    kind: z.literal('text'),
    body: z.string().min(1).max(BODY_MAX),
  }),
  z.strictObject({
    ref: z.string().trim().min(1),
    criterion: z.string().trim().min(1),
    kind: z.literal('url'),
    url: z.url().max(2000),
  }),
])

type Entry = z.infer<typeof entry>
type Ran = { exitCode: number; body: string }
type Stored = { kind: string; body: string | null; url: string | null; exitCode: number | null }
type Refs = Map<string, string>

export type ProofContext = {
  checkout: Checkout
  payload: Conn
  workspace: number
  recordId: number
  criteria: string[]
  headSha: string
}

const problem = (path: string, message: string): Problem => ({ path: `${PROOFS_FILE}${path}`, message })

const cut = (text: string): string => (text.length <= BODY_MAX ? text : text.slice(text.length - BODY_MAX))

const failure = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  killed: z.boolean().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
})

const exitCodeOf = (error: z.infer<typeof failure>): number => {
  if (error.killed) return TIMED_OUT
  return typeof error.code === 'number' ? error.code : FAILED
}

const run = async (checkout: Checkout, command: string): Promise<Ran> => {
  const options = {
    cwd: checkout.dir,
    env: {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: checkout.home,
      CI: '1',
      NODE_ENV: 'test' as const,
    },
    encoding: 'utf8' as const,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: BUFFER_BYTES,
    killSignal: 'SIGKILL' as const,
  }
  const header = (exitCode: number, note = '') => `$ ${command}\nexit code: ${exitCode}${note}\n\n`
  try {
    const done = await exec('sh', ['-c', command], options)
    return { exitCode: 0, body: cut(`${header(0)}${done.stdout}${done.stderr}`) }
  } catch (caught) {
    const error = failure.parse(caught)
    const exitCode = exitCodeOf(error)
    const note = exitCode === TIMED_OUT ? ` (stopped after ${COMMAND_TIMEOUT_MS / 1000} seconds)` : ''
    return { exitCode, body: cut(`${header(exitCode, note)}${error.stdout ?? ''}${error.stderr ?? ''}`) }
  }
}

type Read = { entries: Entry[] } | { problems: Problem[] }

const readEntries = async (dir: string): Promise<Read | null> => {
  const text = await readFile(join(dir, WORK_DIR, PROOFS_FILE), 'utf8').catch(() => null)
  if (text === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { problems: [problem('', 'is not valid JSON: write an array of proofs.')] }
  }
  const checked = z.array(entry).max(50).safeParse(parsed)
  return checked.success
    ? { entries: checked.data }
    : { problems: checked.error.issues.map((issue) => problem(['', ...issue.path].join('.'), issue.message)) }
}

const refusals = (entries: Entry[], criteria: string[]): Problem[] => {
  const seen = new Set<string>()
  return entries.flatMap((item, index) => {
    const path = `.${index}`
    const duplicate = seen.has(item.ref)
    seen.add(item.ref)
    return [
      ...(criteria.includes(item.criterion)
        ? []
        : [problem(`${path}.criterion`, `the record has no criterion ${item.criterion}: use an id from the record.`)]),
      ...(duplicate ? [problem(`${path}.ref`, `ref ${item.ref} is used twice: give every proof its own ref.`)] : []),
    ]
  })
}

const stored = async (checkout: Checkout, item: Entry): Promise<Stored> => {
  if (item.kind === 'text') return { kind: 'output', body: item.body, url: null, exitCode: null }
  if (item.kind === 'url') return { kind: 'link', body: null, url: item.url, exitCode: null }
  const ran = await run(checkout, item.command)
  return { kind: 'output', body: ran.body, url: null, exitCode: ran.exitCode }
}

const insert = async (context: ProofContext, item: Entry, proof: Stored): Promise<string> => {
  const inserted = await context.payload.db.drizzle.execute(sql`
    INSERT INTO "proofs" ("workspace_id", "record_id", "criterion", "kind", "source", "sha", "body", "url",
      "exit_code", "updated_at", "created_at")
    VALUES (${context.workspace}, ${context.recordId}, ${item.criterion}, ${proof.kind}, 'runner', ${context.headSha},
      ${proof.body}, ${proof.url}, ${proof.exitCode}, now(), now())
    RETURNING "id"`)
  return String(z.object({ id: z.coerce.number() }).parse(inserted.rows[0]).id)
}

export type Recorded = { refs: Refs } | { problems: Problem[] }

export const recordProofs = async (context: ProofContext): Promise<Recorded> => {
  const read = await readEntries(context.checkout.dir)
  if (read === null) return { refs: new Map() }
  if ('problems' in read) return read
  const { entries } = read
  const refused = refusals(entries, context.criteria)
  if (refused.length > 0) return { problems: refused }
  await git(context.checkout.dir, context.checkout.env, 'checkout', '--', '.')
  const refs: Refs = new Map()
  for (const item of entries) {
    const proof = await stored(context.checkout, item)
    refs.set(item.ref, await insert(context, item, proof))
  }
  return { refs }
}

const named = z.array(z.looseObject({ proof: z.array(z.string()) }))

export const withProofIds = (raw: Record<string, unknown>, refs: Refs): Record<string, unknown> => {
  const parsed = named.safeParse(raw.criteria)
  if (!parsed.success) return raw
  const criteria = parsed.data.map((c) => ({ ...c, proof: c.proof.map((ref) => refs.get(ref) ?? ref) }))
  return { ...raw, criteria }
}

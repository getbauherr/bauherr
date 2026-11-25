import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import type { AgentRequest } from '../../src/jobs/runner/types'
import { FIX_PROMPT } from '../../src/jobs/runner/workdir'
import { runnerHarness } from './runner-harness'

const r = runnerHarness('core_runner_proofs')
const { f } = r

const IDS = ['c1', 'c2', 'c3']

const commands = (command: string, criteria = IDS) =>
  criteria.map((criterion) => ({ ref: `p-${criterion}`, criterion, kind: 'command', command }))

const claim = (
  request: AgentRequest,
  proofs: unknown[],
  extra: { status?: string; open?: string[]; verdict?: string; findings?: unknown[] } = {},
) => {
  r.edit(request, '.bauherr/proofs.json', JSON.stringify(proofs))
  const criteria = IDS.map((id) => ({
    id,
    status: extra.open?.includes(id) ? 'open' : (extra.status ?? 'met'),
    proof: [`p-${id}`],
  }))
  r.write(request, {
    criteria,
    findings: extra.findings ?? [],
    verdict: extra.verdict ?? 'pass',
    changes: [],
    walkthrough: [],
    notVerified: [],
  })
}

const verifier = (act: (request: AgentRequest) => void) => (request: AgentRequest) => {
  if (request.stage !== 'verify') return Promise.resolve()
  if (r.roleOf(request) === 'reviewer') r.write(request, { findings: [] })
  else act(request)
  return Promise.resolve()
}

const toVerify = async () => {
  const s = await r.toBuild()
  await r.next()
  await r.green(s)
  await r.next()
  return s
}

const stored = (recordId: number) =>
  f.h.rows(sql`SELECT * FROM "proofs" WHERE "record_id" = ${recordId} ORDER BY "id"`)

describe('proofs recorded by the Runner', () => {
  it('runs a command proof in the checkout, stores its exit code and output, and reaches Ship', async () => {
    const s = await toVerify()
    r.state.behaviour = verifier((request) => {
      r.edit(request, '.bauherr/note.txt', 'x')
      claim(request, commands('cat README.md && echo done'))
    })
    expect(await r.next()).toBe('accepted')
    const rows = await stored(s.id)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ criterion: 'c1', kind: 'output', source: 'runner', exit_code: '0' })
    expect(String(rows[0]?.body)).toContain('$ cat README.md && echo done\nexit code: 0')
    expect(String(rows[0]?.body)).toContain('hello')
    expect(String(rows[0]?.sha)).toBe(r.remote.head((await r.pulls(s.repo))[0]?.head ?? ''))
    expect(await r.events(s.id)).toContain('verify.passed')
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship', waitingOn: 'owner' })
    expect(r.gone()).toBe(true)
  })

  it('stores a non-zero exit code, and a criterion met on it is refused until the agent gives up', async () => {
    const s = await toVerify()
    r.state.behaviour = verifier((request) => claim(request, commands('echo broken; exit 3', ['c1']).concat(
      commands('true', ['c2', 'c3']),
    )))
    expect(await r.next()).toBe('failed')
    const [first] = await stored(s.id)
    expect(first).toMatchObject({ criterion: 'c1', exit_code: '3' })
    expect(String(first?.body)).toContain('exit code: 3')
    expect(String(first?.body)).toContain('broken')
    const run = await r.runRow('verify')
    expect(String(run?.error)).toContain('exited with an error')
    expect(await r.events(s.id)).not.toContain('verify.passed')
  })

  it('lets the agent answer a failing command with an open criterion and a finding', async () => {
    const s = await toVerify()
    r.state.behaviour = verifier((request) => {
      const fixing = request.prompt === FIX_PROMPT
      const proofs = commands('exit 2', ['c1']).concat(commands('true', ['c2', 'c3']))
      const answer = fixing ? { open: ['c1'], verdict: 'changes', findings: [r.finding('open')] } : {}
      claim(request, proofs, answer)
    })
    expect(await r.next()).toBe('accepted')
    expect(await r.events(s.id)).toContain('verify.changes')
  })

  it('records a text proof and a link proof as attach_proof does', async () => {
    const s = await toVerify()
    r.state.behaviour = verifier((request) =>
      claim(request, [
        { ref: 'p-c1', criterion: 'c1', kind: 'text', body: 'read src/list.ts: the query takes a limit' },
        { ref: 'p-c2', criterion: 'c2', kind: 'url', url: 'https://example.com/run/1' },
        { ref: 'p-c3', criterion: 'c3', kind: 'text', body: 'looked at the page by hand' },
      ]),
    )
    expect(await r.next()).toBe('accepted')
    const rows = await stored(s.id)
    expect(rows.map((row) => [row.kind, row.exit_code])).toEqual([
      ['output', null],
      ['link', null],
      ['output', null],
    ])
    expect(rows[1]?.url).toBe('https://example.com/run/1')
  })

  it('refuses a proof for a criterion not in the record, stores nothing, and gives one fix turn', async () => {
    const s = await toVerify()
    let problems = ''
    r.state.behaviour = verifier((request) => {
      if (request.prompt === FIX_PROMPT) problems = r.read(request.cwd, 'problems.json')
      claim(request, commands('true', ['c1', 'c2', 'c9']))
    })
    expect(await r.next()).toBe('failed')
    expect(problems).toContain('the record has no criterion c9')
    expect(await stored(s.id)).toEqual([])
    expect(String((await r.runRow('verify'))?.error)).toContain('no criterion c9')
  })

  it('refuses a command proof that reaches the network and runs nothing', async () => {
    const s = await toVerify()
    const marker = join(tmpdir(), `bauherr-proof-${String(s.id)}-${String(Date.now())}`)
    let problems = ''
    r.state.behaviour = verifier((request) => {
      if (request.prompt === FIX_PROMPT) problems = r.read(request.cwd, 'problems.json')
      const proofs = commands('curl https://example.com', ['c1']).concat(commands(`touch ${marker}`, ['c2', 'c3']))
      claim(request, proofs)
    })
    expect(await r.next()).toBe('failed')
    expect(problems).toContain('network access only to the gateway')
    expect(await stored(s.id)).toEqual([])
    expect(existsSync(marker)).toBe(false)
  })

  it('accepts the corrected proofs on the fix turn', async () => {
    const s = await toVerify()
    r.state.behaviour = verifier((request) => {
      claim(request, commands('true', request.prompt === FIX_PROMPT ? IDS : ['c1', 'c2', 'c9']))
    })
    expect(await r.next()).toBe('accepted')
    expect(await stored(s.id)).toHaveLength(3)
    expect(await f.view(s.id)).toMatchObject({ stage: 'ship' })
  })
})

describe('a verdict of changes with nothing to fix', () => {
  it('gets one more turn, not a Build run, and passes once the criteria are proven', async () => {
    const s = await toVerify()
    const problems: string[] = []
    r.state.behaviour = verifier((request) => {
      const fixing = request.prompt === FIX_PROMPT
      if (fixing) problems.push(r.read(request.cwd, 'problems.json'))
      claim(request, commands('true'), fixing ? {} : { status: 'open', verdict: 'changes' })
    })
    expect(await r.next()).toBe('accepted')
    expect(problems.join('')).toContain('attach proof or name a finding')
    const types = await r.events(s.id)
    expect(types).toContain('verify.passed')
    expect(types).not.toContain('verify.changes')
  })

  it('fails the run, and never sends the ticket to Build, when the second answer is the same', async () => {
    const s = await toVerify()
    r.state.behaviour = verifier((request) => claim(request, [], { status: 'open', verdict: 'changes' }))
    expect(await r.next()).toBe('failed')
    expect(await r.events(s.id)).not.toContain('verify.changes')
  })
})

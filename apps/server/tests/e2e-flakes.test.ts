import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const script = join(__dirname, '../../../.github/scripts/e2e-flakes.sh')
const fixture = join(__dirname, 'fixtures/pw-report-flaky.json')
const run = (report: string) => {
  const summary = join(mkdtempSync(join(tmpdir(), 'flakes-')), 'summary.md')
  const r = spawnSync(script, ['2', report], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_STEP_SUMMARY: summary } })
  return { status: r.status, out: r.stdout, summary: existsSync(summary) ? readFileSync(summary, 'utf8').split('\n') : [] }
}

it('lists only the flaky test as one summary row', () => {
  const r = run(fixture)
  expect(r.status).toBe(0)
  expect(r.out).toContain('shard 2): 1')
  expect(r.summary.filter((l) => l.startsWith('| 2 |'))).toEqual(['| 2 | tickets.spec.ts | tickets › opens a \\| ticket |'])
})

it('titles each flake with its describe path, so same-titled tests stay apart', () => {
  const r = run(join(__dirname, 'fixtures/pw-report-same-title.json'))
  expect(r.summary.filter((l) => l.startsWith('| 2 |'))).toEqual(['| 2 | tickets.spec.ts | create › works |', '| 2 | tickets.spec.ts | close › works |'])
})

it('exits 0 without a report', () => {
  expect(run(join(tmpdir(), 'missing.json'))).toMatchObject({ status: 0 })
})

import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

const script = new URL('../../../.github/scripts/merged-sha.sh', import.meta.url).pathname
const pr = (ref: string, merged_at: string | null, sha: string) => ({ head: { ref }, merged_at, merge_commit_sha: sha })
const run = (issue: string, prs: object[]) => spawnSync(script, [issue], { input: JSON.stringify(prs), encoding: 'utf8' })

it('takes the merge sha of the newest merged factory PR of the issue, not of a follow-up', () => {
  const r = run('217', [pr('bauherr/217-337', '2026-11-03T10:00:00Z', 'aaa'), pr('fix/typo', '2026-11-03T12:00:00Z', 'bbb'), pr('bauherr/2170-1', '2026-11-03T13:00:00Z', 'ccc'), pr('bauherr/217-400', null, 'ddd')])
  expect(r.stdout.trim()).toBe('aaa')
})

it('fails when no factory PR of the issue is merged', () => {
  expect(run('217', [pr('fix/typo', '2026-11-03T12:00:00Z', 'bbb')]).status).toBe(1)
})

import { describe, expect, it } from 'vitest'
import { parseEvidence } from '../src/app/(app)/lib/proof'

const md = (rows: string) => `## Evidence
| Goal statement | Status | Evidence |
|---|---|---|
| All tests pass | verified | \`make test\` exit 0 |

| Plan step | done/deferred | Evidence or reason |
|---|---|---|
${rows}

**Self-review**: 2 findings, 2 fixed
`

describe('parseEvidence', () => {
  it('reads the plan step table into proved and no_proof entries and keeps the rest', () => {
    const r = parseEvidence(md('| 1 | done | `src/a.ts`, `tests/a.test.ts` |\n| 2 | deferred | needs the key from #12 |'), [{ n: 1, title: 'Add route' }])
    expect(r?.steps).toEqual([
      { step: 1, title: 'Add route', status: 'proved', proof: '`src/a.ts`, `tests/a.test.ts`' },
      { step: 2, status: 'no_proof', proof: 'needs the key from #12' },
    ])
    expect(r?.rest).toContain('| Goal statement | Status | Evidence |')
    expect(r?.rest).toContain('**Self-review**')
    expect(r?.rest).not.toContain('Plan step')
  })
  it('keeps a 200-character command with pipes whole', () => {
    const cmd = `\`${'pnpm test | tee out.log && '.repeat(8)}\``
    expect(cmd.length).toBeGreaterThan(200)
    expect(parseEvidence(md(`| 3 | done | ${cmd} |`))?.steps[0]).toMatchObject({ step: 3, status: 'proved', proof: cmd })
  })
  it('a done row without evidence is no proof', () => expect(parseEvidence(md('| 4 | done |  |'))?.steps[0]).toMatchObject({ step: 4, status: 'no_proof', proof: '' }))
  it('returns null without a plan step table so the page can fall back to markdown', () => {
    expect(parseEvidence('## Evidence\n| Goal statement | Status | Evidence |\n|---|---|---|\n| a | verified | b |')).toBeNull()
    expect(parseEvidence(null)).toBeNull()
    expect(parseEvidence(md(''))).toBeNull()
  })
})

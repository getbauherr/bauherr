import { describe, expect, it } from 'vitest'
import { applyChange, applyKept, undecidedCount } from '../src/core/retro/changes'
import { parseReply } from '../src/core/retro/prompt'
import type { Outcome } from '../src/core/retro/schema'

const BODY = '## All stages\n- One.\n\n## Brief\n- A visible change gets a mockup.\n\n## Build\n- Two.\n'

describe('applying one change to a document', () => {
  it('replaces the line it removes with the new line', () => {
    const out = applyChange(BODY, { section: 'Brief', remove: '- A visible change gets a mockup.', add: '- New.' })
    expect(out).toBe('## All stages\n- One.\n\n## Brief\n- New.\n\n## Build\n- Two.\n')
  })

  it('adds a line at the end of its section when it removes nothing', () => {
    const out = applyChange(BODY, { section: 'Brief', remove: null, add: '- Added.' })
    const brief = '- A visible change gets a mockup.\n- Added.'
    expect(out).toBe(`## All stages\n- One.\n\n## Brief\n${brief}\n\n## Build\n- Two.\n`)
  })

  it('adds a missing section at the end and a line when the line to remove is gone', () => {
    expect(applyChange(BODY, { section: 'Verify', remove: null, add: '- V.' })).toBe(`${BODY}\n## Verify\n- V.\n`)
    expect(applyChange('', { section: 'Build', remove: 'gone', add: '- B.' })).toBe('## Build\n- B.\n')
  })

  it('applies only the kept changes', () => {
    const change = (id: string, decision: 'keep' | 'discard') => ({
      id,
      title: id,
      section: 'Build' as const,
      remove: null,
      add: `- ${id}`,
      decision,
    })
    expect(applyKept('', [change('a', 'keep'), change('b', 'discard')])).toBe('## Build\n- a\n')
  })
})

describe('counting what is undecided', () => {
  it('counts changes and tickets that nobody decided', () => {
    const outcome: Outcome = {
      documents: [
        {
          scope: 'product',
          base: '',
          changes: [{ id: 'a', title: 'a', section: 'Build', remove: null, add: 'x', decision: 'undecided' }],
        },
      ],
      tickets: [{ id: 't', title: 't', body: 'b', repo: 'product', decision: 'undecided', number: null }],
      saved: [],
    }
    expect(undecidedCount(outcome)).toBe(2)
  })
})

describe('reading the factory reply', () => {
  const change = '"change":{"section":"Build","add":"- x"}'
  const proposal = `{"id":"p","level":"product","title":"t",${change}}`

  it('takes the JSON object out of surrounding text', () => {
    const reply = parseReply(`Here you go: {"message":"Hi","proposals":[${proposal}]} done`)
    expect(reply.proposals[0]).toMatchObject({ id: 'p', confidence: 'medium', change: { remove: null } })
  })

  it('refuses text that is not a reply and a document proposal without a change', () => {
    expect(() => parseReply('no json here')).toThrow('could not read')
    expect(() => parseReply('{"message":"m","proposals":[{"id":"p","level":"product","title":"t"}]}')).toThrow()
  })
})

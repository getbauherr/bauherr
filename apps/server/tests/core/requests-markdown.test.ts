import { describe, expect, it } from 'vitest'
import { bodyOf, titleOf } from '../../src/core/requests/send'
import type { Draft } from '../../src/core/requests/store'

const draftWith = (text: string): Draft => ({
  conversationId: 7,
  workspace: 1,
  product: 1,
  state: 'open',
  issueNumber: null,
  recordId: null,
  createdBy: 'a@b.c',
  data: {
    type: 'bug',
    typeConfirmed: true,
    title: text,
    summary: text,
    fields: { happened: text, expected: text, steps: text, where: text, frequency: text },
    rounds: 0,
    questions: [],
    offered: false,
    offer: null,
    joined: null,
    answer: null,
  },
})

const file = (name: string) => ({ id: 3, name, contentType: 'application/pdf', bytes: 1 })
const render = (text: string, name = 'a.pdf') => bodyOf(draftWith(text), [file(name)], 'https://b.test', 'k')

describe('owner words in the issue', () => {
  it.each(['Closes #3', 'fixes: #12', 'RESOLVED #9', 'closes https://github.com/o/r/issues/3'])(
    'defuses the closing keyword in %s',
    (text) => {
      expect(render(text)).not.toMatch(/\b(clos\w*|fix\w*|resolv\w*)(?!​)\W+\S*(#\d|https?:)/i)
      expect(titleOf(draftWith(text))).not.toMatch(/\b(clos\w*|fix\w*|resolv\w*)(?!​)\W+\S*(#\d|https?:)/i)
    },
  )

  it('breaks an @mention', () => {
    expect(render('ping @maintainers please')).not.toContain('@maintainers')
    expect(titleOf(draftWith('hi @maintainers'))).not.toContain('@maintainers')
  })

  it('escapes markdown syntax and keeps one heading per field', () => {
    const body = render('# Big\n[x](https://evil) <img src=x> `code`')
    expect(body).not.toMatch(/^# Big/m)
    expect(body).not.toContain('[x](https://evil)')
    expect(body).not.toMatch(/(?<!\\)<img/)
    expect(body).not.toContain('`code`')
  })

  it('keeps a file name from inserting a link', () => {
    const body = render('x', 'a](https://evil)[b')
    expect(body).not.toContain('](https://evil)')
    expect(body).toContain('(https://b.test/api/request-files/7/3/')
  })
})

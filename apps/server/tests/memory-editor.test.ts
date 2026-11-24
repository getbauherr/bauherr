import { markdown } from '@codemirror/lang-markdown'
import { EditorState, type StateCommand } from '@codemirror/state'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  continueList,
  indentList,
  memoryKeymap,
  outdentList,
  TOOLS,
} from '../src/app/(app)/components/memory/editor-commands'
import { memoryDecorations, ProblemNote } from '../src/app/(app)/components/memory/editor-decorations'
import { MemoryPreview } from '../src/app/(app)/components/memory/MemoryPreview'
import { diffOf } from '../src/app/(app)/lib/memory-diff'
import {
  HEADING_MESSAGE,
  lineCount,
  linesOver,
  problemsOf,
  TICKET_NUMBER_MESSAGE,
} from '../src/app/(app)/lib/memory-checks'
import { pickScope, scopeOptions } from '../src/app/(app)/lib/memory-scope'

const apply = (command: StateCommand, doc: string, from: number, to = from): string => {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to } })
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

const tool = (id: string) => TOOLS.find((entry) => entry.id === id)!
const bound = (key: string) => memoryKeymap.find((binding) => binding.key === key)

const WORD = 'word'
const EXPECTED: Record<string, { doc: string; from: number; to: number; out: string }> = {
  bold: { doc: WORD, from: 0, to: 4, out: '**word**' },
  italic: { doc: WORD, from: 0, to: 4, out: '*word*' },
  code: { doc: WORD, from: 0, to: 4, out: '`word`' },
  'code-block': { doc: WORD, from: 0, to: 4, out: '```\nword\n```' },
  bullets: { doc: 'one\ntwo', from: 0, to: 7, out: '- one\n- two' },
  numbers: { doc: 'one\ntwo', from: 0, to: 7, out: '1. one\n2. two' },
  link: { doc: WORD, from: 0, to: 4, out: '[word](https://)' },
}

describe('the toolbar and its shortcuts', () => {
  it.each(Object.entries(EXPECTED))('the %s button turns the selection into markdown', (id, { doc, from, to, out }) => {
    expect(apply(tool(id).run, doc, from, to)).toBe(out)
  })

  it.each(TOOLS.filter((entry) => entry.key))('the shortcut of the $label button does the same', (entry) => {
    const { doc, from, to, out } = EXPECTED[entry.id]
    expect(bound(entry.key!)?.run).toBe(entry.run)
    expect(apply(entry.run, doc, from, to)).toBe(out)
  })

  it('names the shortcuts the Brief lists', () => {
    expect(TOOLS.flatMap((entry) => (entry.shortcut ? [entry.shortcut] : []))).toEqual([
      'Ctrl+B',
      'Ctrl+I',
      'Ctrl+E',
      'Ctrl+Shift+8',
      'Ctrl+Shift+7',
      'Ctrl+K',
    ])
    expect(TOOLS.map((entry) => entry.key)).toEqual([
      'Mod-b',
      'Mod-i',
      'Mod-e',
      undefined,
      'Mod-Shift-8',
      'Mod-Shift-7',
      'Mod-k',
    ])
  })

  it('removes a list marker the second time and puts the cursor between empty marks', () => {
    expect(apply(tool('bullets').run, '- one\n- two', 0, 11)).toBe('one\ntwo')
    expect(apply(tool('bold').run, '', 0)).toBe('****')
  })

  it('continues a list on Enter, counts numbers up and ends it on an empty item', () => {
    const enter = continueList
    expect(apply(enter, '- one', 5)).toBe('- one\n- ')
    expect(apply(enter, '1. one', 6)).toBe('1. one\n2. ')
    expect(apply(enter, '- one\n- ', 8)).toBe('- one\n')
    expect(apply(enter, 'plain', 5)).toBe('plain')
  })

  it('indents a list item on Tab and leaves other lines to the browser', () => {
    expect(apply(indentList, '- one', 5)).toBe('  - one')
    expect(indentList({ state: EditorState.create({ doc: 'plain' }), dispatch: () => {} })).toBe(false)
    expect(apply(outdentList, '  - one', 6)).toBe('- one')
  })
})

describe('live checks', () => {
  it('flags a ticket number and a heading outside the stage headings', () => {
    const body = '## Verify\n- Run page (#555) is queued.\n### Extra\n# Title\n## Brief'
    expect(problemsOf(body).map((problem) => [problem.line, problem.message])).toEqual([
      [2, TICKET_NUMBER_MESSAGE],
      [3, HEADING_MESSAGE],
      [4, HEADING_MESSAGE],
    ])
  })

  it('leaves the stage headings and fenced code alone', () => {
    const body = [
      '## All stages',
      '## Brief',
      '## Build',
      '## Review',
      '## Verify',
      '```',
      '# not a heading #12',
      '```',
    ].join('\n')
    expect(problemsOf(body)).toEqual([])
  })

  it('shows the message under the line', () => {
    const state = EditorState.create({
      doc: '## Verify\n- Run page (#555) is queued.',
      extensions: [markdown(), memoryDecorations],
    })
    const notes: string[] = []
    state.field(memoryDecorations).between(0, state.doc.length, (_from, _to, value) => {
      const widget: unknown = (value.spec as { widget?: unknown }).widget
      if (widget instanceof ProblemNote) notes.push(...widget.messages)
    })
    expect(notes).toEqual([TICKET_NUMBER_MESSAGE])
  })

  it('counts lines the way Save does', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('a\nb\n')).toBe(2)
    expect(linesOver('x\n'.repeat(203), 200)).toBe(3)
  })
})

describe('the preview', () => {
  it('shows the text Save stores, formatted', () => {
    const body = '## All stages\n- Use `pnpm` for every script.\n\n```text\nfile.sql\n```'
    const html = renderToStaticMarkup(createElement(MemoryPreview, { body }))
    expect(html).toContain('All stages</h2>')
    expect(html).toContain('<li')
    expect(html).toContain('pnpm</code>')
    expect(html).toContain('file.sql')
    expect(html).not.toContain('## All stages')
  })
})

describe('versions and scope', () => {
  it('marks added and removed lines with one line of context', () => {
    const diff = diffOf(
      '## Verify\n- Show every screen.\n- Keep it.\n- Far away.\n- Farther.',
      '## Verify\n- Show every screen at 375 px.\n- Keep it.\n- Far away.\n- Farther.',
    )
    expect(diff).toEqual({
      additions: 1,
      deletions: 1,
      lines: [
        { kind: 'context', text: '## Verify' },
        { kind: 'removed', text: '- Show every screen.' },
        { kind: 'added', text: '- Show every screen at 375 px.' },
        { kind: 'context', text: '- Keep it.' },
      ],
    })
    expect(diffOf('', 'a\nb')).toMatchObject({ additions: 2, deletions: 0 })
  })

  it('offers Factory, Workspace and each Product and defaults to the first Product', () => {
    const options = scopeOptions('Acme', [
      { id: 4, name: 'Web' },
      { id: 9, name: 'Shop' },
    ])
    expect(options.map((option) => option.label)).toEqual([
      'Factory',
      'Workspace: Acme',
      'Product: Web',
      'Product: Shop',
    ])
    expect(pickScope(options, undefined)?.value).toBe('product-4')
    expect(pickScope(options, 'workspace')?.choice).toEqual({ scope: 'workspace' })
    expect(pickScope(scopeOptions('Acme', []), 'bogus')?.value).toBe('workspace')
  })
})

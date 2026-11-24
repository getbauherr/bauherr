import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { problemsOf, TICKET_NUMBER_MESSAGE } from '../../lib/memory-checks'

export class ProblemNote extends WidgetType {
  constructor(readonly messages: string[]) {
    super()
  }

  override eq(other: ProblemNote): boolean {
    return other.messages.join('|') === this.messages.join('|')
  }

  override toDOM(): HTMLElement {
    const note = document.createElement('div')
    note.className = 'cm-problem'
    note.textContent = this.messages.join(' ')
    return note
  }
}

const MARKS: Record<string, Decoration> = {
  HeaderMark: Decoration.mark({ class: 'cm-h' }),
  ListMark: Decoration.mark({ class: 'cm-m' }),
  InlineCode: Decoration.mark({ class: 'cm-ic' }),
  CodeText: Decoration.mark({ class: 'cm-fb' }),
  CodeMark: Decoration.mark({ class: 'cm-fe' }),
  CodeInfo: Decoration.mark({ class: 'cm-fe' }),
}
const HEADING = Decoration.mark({ class: 'cm-h' })
const SQUIGGLE = Decoration.mark({ class: 'cm-ticket' })

type Entry = { from: number; to: number; value: Decoration; block?: boolean }

const marksOf = (state: EditorState): Entry[] => {
  const entries: Entry[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      const value = node.name.startsWith('ATXHeading') ? HEADING : MARKS[node.name]
      if (value && node.to > node.from) entries.push({ from: node.from, to: node.to, value })
    },
  })
  return entries
}

const notesOf = (state: EditorState): Entry[] => {
  const byLine = new Map<number, { to: number; messages: string[] }>()
  const squiggles: Entry[] = []
  for (const problem of problemsOf(state.doc.toString())) {
    const line = state.doc.line(problem.line)
    const found = byLine.get(line.number) ?? { to: line.to, messages: [] }
    if (!found.messages.includes(problem.message)) found.messages.push(problem.message)
    byLine.set(line.number, found)
    if (problem.message === TICKET_NUMBER_MESSAGE) {
      squiggles.push({ from: problem.from, to: problem.to, value: SQUIGGLE })
    }
  }
  const widgets = [...byLine.values()].map(({ to, messages }) => ({
    from: to,
    to,
    value: Decoration.widget({ widget: new ProblemNote(messages), block: true, side: 1 }),
  }))
  return [...squiggles, ...widgets]
}

const build = (state: EditorState): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>()
  const entries = [...marksOf(state), ...notesOf(state)]
  entries.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  for (const entry of entries) builder.add(entry.from, entry.to, entry.value)
  return builder.finish()
}

export const memoryDecorations = StateField.define<DecorationSet>({
  create: build,
  update: (_, transaction) => build(transaction.state),
  provide: (field) => EditorView.decorations.from(field),
})

export const memoryTheme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'var(--surface-000)', color: 'var(--ink)' },
  '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)', lineHeight: '22px' },
  '.cm-content': { padding: '8px 0', minHeight: '440px', caretColor: 'var(--ink)' },
  '.cm-line': { padding: '0 16px' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-100)',
    color: 'var(--ink-muted)',
    borderRight: '1px solid var(--hairline)',
  },
  '.cm-h': { color: 'var(--accent)', fontWeight: '600' },
  '.cm-m': { color: 'var(--warn)', fontWeight: '600' },
  '.cm-ic': { backgroundColor: 'var(--surface-200)', borderRadius: '3px' },
  '.cm-fe': { color: 'var(--ok)' },
  '.cm-fb': { color: 'var(--ok)', backgroundColor: 'color-mix(in srgb, var(--ok) 8%, transparent)' },
  '.cm-ticket': { textDecoration: 'underline wavy var(--warn)', textUnderlineOffset: '3px' },
  '.cm-problem': {
    margin: '2px 16px 4px',
    maxWidth: '520px',
    padding: '4px 8px',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    fontSize: '13px',
    lineHeight: '18px',
    color: 'var(--warn)',
    backgroundColor: 'color-mix(in srgb, var(--warn) 12%, transparent)',
    borderLeft: '3px solid var(--warn)',
  },
})

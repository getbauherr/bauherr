import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s(.*)$/
const LIST_INDENT = '  '
const LINK_URL = 'https://'

export const wrap =
  (before: string, after = before): StateCommand =>
  ({ state, dispatch }) => {
    dispatch(
      state.update(
        state.changeByRange((range) => {
          const text = state.sliceDoc(range.from, range.to)
          const from = range.from + before.length
          return {
            changes: { from: range.from, to: range.to, insert: before + text + after },
            range: EditorSelection.range(from, from + text.length),
          }
        }),
        { userEvent: 'input', scrollIntoView: true },
      ),
    )
    return true
  }

export const codeBlock: StateCommand = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to)
        const from = range.from + 4
        return {
          changes: { from: range.from, to: range.to, insert: `\`\`\`\n${text}\n\`\`\`` },
          range: EditorSelection.range(from, from + text.length),
        }
      }),
      { userEvent: 'input', scrollIntoView: true },
    ),
  )
  return true
}

export const link: StateCommand = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to)
        const from = range.from + text.length + 3
        return {
          changes: { from: range.from, to: range.to, insert: `[${text}](${LINK_URL})` },
          range: EditorSelection.range(from, from + LINK_URL.length),
        }
      }),
      { userEvent: 'input', scrollIntoView: true },
    ),
  )
  return true
}

const markerOf = (kind: 'bullet' | 'numbered', position: number): string =>
  kind === 'bullet' ? '- ' : `${position + 1}. `

export const list =
  (kind: 'bullet' | 'numbered'): StateCommand =>
  ({ state, dispatch }) => {
    const first = state.doc.lineAt(state.selection.main.from).number
    const last = state.doc.lineAt(state.selection.main.to).number
    const lines = Array.from({ length: last - first + 1 }, (_, index) => state.doc.line(first + index))
    const marked = lines.every((line) => LIST_ITEM.test(line.text))
    dispatch(
      state.update({
        changes: lines.map((line, position) => {
          const item = LIST_ITEM.exec(line.text)
          const body = item ? (item[1] ?? '') + (item[3] ?? '') : line.text
          return { from: line.from, to: line.to, insert: marked ? body : markerOf(kind, position) + body }
        }),
        userEvent: 'input',
        scrollIntoView: true,
      }),
    )
    return true
  }

export const continueList: StateCommand = ({ state, dispatch }) => {
  const { from, empty } = state.selection.main
  const line = state.doc.lineAt(from)
  const item = LIST_ITEM.exec(line.text)
  if (!empty || !item || from !== line.to) return false
  const [, indent = '', marker = '', text = ''] = item
  if (text === '') {
    dispatch(state.update({ changes: { from: line.from, to: line.to, insert: '' }, userEvent: 'delete' }))
    return true
  }
  const next = /^\d+\.$/.test(marker) ? `${parseInt(marker, 10) + 1}.` : marker
  const insert = `\n${indent}${next} `
  dispatch(
    state.update({
      changes: { from, insert },
      selection: { anchor: from + insert.length },
      userEvent: 'input',
      scrollIntoView: true,
    }),
  )
  return true
}

export const indentList: StateCommand = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.from)
  if (!LIST_ITEM.test(line.text)) return false
  dispatch(state.update({ changes: { from: line.from, insert: LIST_INDENT }, userEvent: 'input.indent' }))
  return true
}

export const outdentList: StateCommand = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.from)
  if (!LIST_ITEM.test(line.text) || !line.text.startsWith(LIST_INDENT)) return false
  dispatch(
    state.update({
      changes: { from: line.from, to: line.from + LIST_INDENT.length },
      userEvent: 'delete.dedent',
    }),
  )
  return true
}

export type Tool = {
  id: string
  label: string
  shortcut?: string
  key?: string
  run: StateCommand
}

export const TOOLS: Tool[] = [
  { id: 'bold', label: 'Bold', shortcut: 'Ctrl+B', key: 'Mod-b', run: wrap('**') },
  { id: 'italic', label: 'Italic', shortcut: 'Ctrl+I', key: 'Mod-i', run: wrap('*') },
  { id: 'code', label: 'Code', shortcut: 'Ctrl+E', key: 'Mod-e', run: wrap('`') },
  { id: 'code-block', label: 'Code block', run: codeBlock },
  { id: 'bullets', label: 'Bulleted list', shortcut: 'Ctrl+Shift+8', key: 'Mod-Shift-8', run: list('bullet') },
  { id: 'numbers', label: 'Numbered list', shortcut: 'Ctrl+Shift+7', key: 'Mod-Shift-7', run: list('numbered') },
  { id: 'link', label: 'Link', shortcut: 'Ctrl+K', key: 'Mod-k', run: link },
]

export const memoryKeymap: KeyBinding[] = [
  ...TOOLS.flatMap((tool) => (tool.key ? [{ key: tool.key, run: tool.run, preventDefault: true }] : [])),
  { key: 'Enter', run: continueList },
  { key: 'Tab', run: indentList },
  { key: 'Shift-Tab', run: outdentList },
]

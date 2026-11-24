import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { memoryKeymap } from './editor-commands'
import { memoryDecorations, memoryTheme } from './editor-decorations'

export const memoryExtensions = (onChange: (body: string) => void, readOnly: boolean): Extension[] => [
  EditorState.readOnly.of(readOnly),
  lineNumbers(),
  history(),
  keymap.of([...memoryKeymap, ...defaultKeymap, ...historyKeymap]),
  markdown(),
  EditorView.lineWrapping,
  memoryDecorations,
  memoryTheme,
  EditorView.contentAttributes.of({ 'aria-label': 'Memory document', 'aria-multiline': 'true' }),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) onChange(update.state.doc.toString())
  }),
]

export const memoryState = (body: string, onChange: (body: string) => void, readOnly: boolean): EditorState =>
  EditorState.create({ doc: body, extensions: memoryExtensions(onChange, readOnly) })

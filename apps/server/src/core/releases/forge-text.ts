import { inertBlock } from '../requests/markdown'
import { emojiOf } from './notes-areas'
import type { NoteItem } from './notes'

const SECTIONS = [
  { kind: 'new', heading: '## ✨ New and improved' },
  { kind: 'fixed', heading: '## 🔧 Fixed' },
] as const

const line = (entry: NoteItem): string => {
  const area = `${emojiOf(entry.area)} ${entry.area}`
  const text = inertBlock(entry.text)
  return entry.title === null ? `- (${area}): ${text}` : `- **${inertBlock(entry.title)}** (${area}): ${text}`
}

const internalNote = (internal: number): string => {
  if (internal === 0) return ''
  return `; ${internal} internal ${internal === 1 ? 'change' : 'changes'} not listed`
}

export const nothingVisible = (internal: number): string =>
  `Nothing visible to users in this version${internalNote(internal)}.`

export const forgeText = (items: NoteItem[], internal: number, link: string): string => {
  const shown = items.filter((entry) => !entry.removed)
  const sections = SECTIONS.flatMap(({ kind, heading }) => {
    const mine = shown.filter((entry) => entry.kind === kind)
    return mine.length === 0 ? [] : [[heading, '', ...mine.map(line)].join('\n')]
  })
  const body = sections.length === 0 ? [nothingVisible(internal)] : sections
  return [...body, `[Read the full release notes in Bauherr](${link})`].join('\n\n')
}

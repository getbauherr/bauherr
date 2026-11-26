import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const app = join(import.meta.dirname, '..', '..', 'src', 'app', '(app)')

const SURFACES = [
  'components/conversation/Thread.tsx',
  'components/conversation/Composer.tsx',
  'components/conversation/ConversationView.tsx',
  'components/request/NewRequest.tsx',
  'components/request/CommentList.tsx',
  'components/ticket/CommentRuntime.tsx',
  '(shell)/memory/retro/[id]/page.tsx',
  'components/retro/RetroComposer.tsx',
]

const KNOWN_EXCEPTIONS = [
  'components/request/CommentList.tsx',
  '(shell)/memory/retro/[id]/page.tsx',
  'components/retro/RetroComposer.tsx',
]

const usesAssistantUi = (file: string): boolean =>
  /from ['"]@assistant-ui\/react['"]/.test(readFileSync(join(app, file), 'utf8'))

test('every chat surface renders through @assistant-ui/react', () => {
  const missing = SURFACES.filter((file) => !KNOWN_EXCEPTIONS.includes(file) && !usesAssistantUi(file))
  const help = 'Build chat with assistant-ui primitives (ThreadPrimitive, MessagePrimitive, ComposerPrimitive).'
  expect(missing, help).toEqual([])
})

test('a known exception that now uses assistant-ui leaves the list', () => {
  const migrated = KNOWN_EXCEPTIONS.filter(usesAssistantUi)
  expect(migrated, 'Remove the file from KNOWN_EXCEPTIONS: the list only shrinks.').toEqual([])
})

test('the known exceptions are chat surfaces', () => {
  expect(KNOWN_EXCEPTIONS.filter((file) => !SURFACES.includes(file))).toEqual([])
})

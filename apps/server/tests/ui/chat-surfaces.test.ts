import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const app = join(import.meta.dirname, '..', '..', 'src', 'app', '(app)')

const SURFACES = [
  'components/assistant-ui/elements/thread.aui.tsx',
  'components/assistant-ui/elements/thread-composer.tsx',
  'components/conversation/ConversationView.tsx',
  'components/request/NewRequest.tsx',
  'components/request/CommentList.tsx',
  'components/ticket/CommentRuntime.tsx',
  'components/retro/RetroThread.tsx',
]

const usesAssistantUi = (file: string): boolean =>
  /from ['"]@assistant-ui\/react['"]/.test(readFileSync(join(app, file), 'utf8'))

test('every chat surface renders through @assistant-ui/react', () => {
  const missing = SURFACES.filter((file) => !usesAssistantUi(file))
  const help = 'Build chat with assistant-ui primitives (ThreadPrimitive, MessagePrimitive, ComposerPrimitive).'
  expect(missing, help).toEqual([])
})

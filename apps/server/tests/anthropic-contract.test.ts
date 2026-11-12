import { expect, it } from 'vitest'
import { chatBody } from '../src/lib/chat/stream'
import { contractViolations } from './helpers/anthropic-contract'

const user = { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }
const tool = { name: 'refine', description: 'd', input_schema: { type: 'object' } }

it('accepts what chatBody builds for a plain call, a call that must end in one tool, and a call without tools', () => {
  expect(contractViolations(chatBody('ws-a/m', { system: 'S', messages: [user], tools: [tool] }))).toEqual([])
  expect(contractViolations(chatBody('ws-a/m', { system: 'S', messages: [user], tools: [tool], forceTool: 'refine' }))).toEqual([])
  expect(contractViolations(chatBody('ws-a/m', { system: 'S', messages: [user], tools: [], noTools: true }))).toEqual([])
})

it('names every rule a body can break', () => {
  const ok = chatBody('ws-a/m', { system: 'S', messages: [user], tools: [tool] })
  const broken = (patch: Record<string, unknown>) => contractViolations({ ...ok, ...patch })
  expect(broken({ tool_choice: { type: 'tool', name: 'refine' } })).toEqual(['forced tool_choice tool'])
  expect(broken({ tool_choice: { type: 'any' } })).toEqual(['forced tool_choice any'])
  expect(broken({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'x' }] }] })).toEqual(['first message is not from the user'])
  expect(broken({ messages: [{ role: 'user', content: [{ type: 'text', text: '  ' }] }] })).toEqual(['message 0: empty text block'])
  expect(broken({ messages: [{ role: 'user', content: [] }] })).toEqual(['message 0: empty content'])
  expect(broken({ messages: [] })).toEqual(['no messages'])
  expect(broken({ tools: [{ name: '', input_schema: { type: 'object' } }, { name: 'x' }] })).toEqual(['tool without name', 'tool x: input_schema is not an object schema'])
  expect(broken({ max_tokens: undefined })).toEqual(['max_tokens missing'])
  expect(broken({ model: '' })).toEqual(['model missing'])
})

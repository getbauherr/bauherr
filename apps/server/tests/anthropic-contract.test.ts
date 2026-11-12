import { expect, it } from 'vitest'
import { chatBody, gatewayChatModel } from '../src/lib/chat/stream'
import { answer, contractViolations, spyOnModelFetch } from './helpers/anthropic-contract'

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

const shot = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'iVBORw0KGgo=' } }

it('accepts a message with an image block, and names the broken image rules', () => {
  const body = (content: unknown[]) => chatBody('ws-a/m', { system: 'S', messages: [{ role: 'user', content } as never], tools: [tool] })
  expect(contractViolations(body([shot, { type: 'text', text: 'see' }]))).toEqual([])
  expect(contractViolations(body([{ type: 'image_ref', mediaId: 4 }, { type: 'text', text: 'see' }]))).toEqual(['message 0: unresolved image reference'])
  expect(contractViolations(body([{ ...shot, source: { ...shot.source, media_type: 'image/bmp' } }, { type: 'text', text: 'see' }]))).toEqual(['message 0: bad image block'])
})

it('sends the model the Workspace tier names and the image as a base64 block', async () => {
  const spy = spyOnModelFetch(answer({ text: 'ok' }))
  try {
    const model = gatewayChatModel({ slug: 'acme', key: 'k', model: 'claude-opus-5-5' })
    for await (const _ of model({ system: 'S', messages: [{ role: 'user', content: [shot, { type: 'text', text: 'see' }] }], tools: [tool] })) void _
    expect(spy.bodies[0]!.model).toBe('ws-acme/claude-opus-5-5')
    expect(spy.bodies[0]!.messages[0].content[0]).toEqual(shot)
    expect(contractViolations(spy.bodies[0]!)).toEqual([])
  } finally {
    spy.restore()
  }
})

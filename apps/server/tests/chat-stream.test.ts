import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseAnthropicStream, type ModelEvent } from '../src/lib/chat/stream'

const body = (text: string, size: number) => {
  const bytes = new TextEncoder().encode(text)
  let at = 0
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.length) return c.close()
      c.enqueue(bytes.slice(at, (at += size)))
    },
  })
}
const collect = async (s: ReadableStream<Uint8Array>): Promise<ModelEvent[]> => {
  const out: ModelEvent[] = []
  for await (const e of parseAnthropicStream(s)) out.push(e)
  return out
}
const fixture = readFileSync(new URL('./fixtures/chat-stream.sse', import.meta.url), 'utf8')

it('parses text deltas, tool_use blocks with split input_json_delta, and the usage of a recorded stream', async () => {
  expect(await collect(body(fixture, 4096))).toEqual([
    { type: 'text', text: 'Let me ' },
    { type: 'text', text: 'check.' },
    { type: 'tool_use', id: 'toolu_01A', name: 'list_tickets', input: { stage: 'plan', limit: 5 } },
    { type: 'tool_use', id: 'toolu_01B', name: 'factory_status', input: {} },
    { type: 'usage', tokensIn: 420, tokensOut: 87, model: 'claude-sonnet-5-5' },
  ])
})

it('gives the same events when the stream arrives in 7-byte chunks and with CRLF line ends', async () => {
  const events = await collect(body(fixture.replace(/\n/g, '\r\n'), 7))
  expect(events).toEqual(await collect(body(fixture, 4096)))
})

it('throws on a stream error event', async () => {
  await expect(collect(body('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n', 64))).rejects.toThrow('Overloaded')
})

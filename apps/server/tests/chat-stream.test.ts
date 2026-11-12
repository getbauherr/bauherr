import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAnthropicStream, partialReply, type ModelEvent } from '../src/lib/chat/stream'

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
    { type: 'tool_delta', id: 'toolu_01A', name: 'list_tickets', json: '{"stage": "pl' },
    { type: 'tool_delta', id: 'toolu_01A', name: 'list_tickets', json: '{"stage": "plan", "limit": 5}' },
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

it('a call that must end in one tool never sends a forced tool_choice (current models answer it with HTTP 400)', async () => {
  const { chatBody, mustCall, upstreamReason } = await import('../src/lib/chat/stream')
  const forced = chatBody('ws-a/b/m', { system: 'S', messages: [], tools: [], forceTool: 'refine' })
  expect(forced.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true })
  expect(forced.system).toBe('S' + mustCall('refine'))
  expect(String(forced.system)).toContain('`refine`')
  const plain = chatBody('ws-a/b/m', { system: 'S', messages: [], tools: [] })
  expect(plain.tool_choice).toBeUndefined()
  expect(plain.system).toBe('S')
  expect(chatBody('ws-a/b/m', { system: 'S', messages: [], tools: [], noTools: true }).tool_choice).toEqual({ type: 'none' })
  expect(upstreamReason('{"type":"error","error":{"type":"invalid_request_error","message":"tool_choice: type \\"tool\\" and \\"any\\" are not supported for this model."}}')).toContain('not supported for this model')
  expect(upstreamReason('<html>')).toBe('')
})

describe('partialReply: the growing reply of a tool input that is still arriving', () => {
  const inputs = [
    '{"reply":"Plain words.","settled":[]}',
    '{ "reply" : "Quote \\" and backslash \\\\ and slash \\/ and\\nnewline\\ttab","settled":[{"id":"D1","answer":"x"}]}',
    '{"reply":"Unicode \\u00e4\\u00df and emoji \\ud83d\\ude00 done","next":"ask"}',
  ]

  it.each(inputs)('is a prefix of the final reply at every byte, never ends in half an escape, and ends equal to it (%#)', (json) => {
    const full = (JSON.parse(json) as { reply: string }).reply
    let prev = ''
    for (let i = 0; i <= json.length; i++) {
      const got = partialReply(json.slice(0, i))
      if (got === null) {
        expect(prev).toBe('')
        continue
      }
      expect(full.startsWith(got), `at ${i}: ${JSON.stringify(got)}`).toBe(true)
      expect(got.length).toBeGreaterThanOrEqual(prev.length)
      prev = got
    }
    expect(prev).toBe(full)
  })

  it('gives null until the reply has started, and nothing for a reply that is not the first property', () => {
    expect(partialReply('')).toBeNull()
    expect(partialReply('{"rep')).toBeNull()
    expect(partialReply('{"reply":')).toBeNull()
    expect(partialReply('{"settled":[],"reply":"late"}')).toBeNull()
    expect(partialReply('{"reply":"')).toBe('')
  })

  it('holds back a lone high surrogate and a cut \\u escape', () => {
    expect(partialReply('{"reply":"a\\ud83d')).toBe('a')
    expect(partialReply('{"reply":"a\\u00')).toBe('a')
    expect(partialReply('{"reply":"a\\')).toBe('a')
  })

  it('follows a real tool input stream split at every byte', async () => {
    const json = JSON.stringify({ reply: 'Streams "in" pieces.\nSecond line.', settled: [] })
    const sse = (d: unknown) => `event: x\ndata: ${JSON.stringify(d)}\n\n`
    const text =
      sse({ type: 'message_start', message: { usage: { input_tokens: 1 }, model: 'm' } }) +
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'refine' } }) +
      [...json].map((c) => sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: c } })).join('') +
      sse({ type: 'content_block_stop', index: 0 })
    const events = await collect(body(text, 5))
    const replies = events.flatMap((e) => (e.type === 'tool_delta' ? [partialReply(e.json)] : []))
    expect(replies.at(-1)).toBe('Streams "in" pieces.\nSecond line.')
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(1)
  })
})

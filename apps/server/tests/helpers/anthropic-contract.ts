import { vi } from 'vitest'

type Json = Record<string, any>

/**
 * The request rules of the Messages API we know and that a scripted model never enforces (the real API answers a broken body with HTTP 400):
 * model and max_tokens set; no forced tool_choice (`tool`, `any`: current models reject it); messages start with the user and carry no empty content or empty text block;
 * every tool has a name and an object input_schema. Returns the broken rules, empty when the body is fine.
 */
export const contractViolations = (body: Json): string[] => {
  const bad: string[] = []
  if (typeof body.model !== 'string' || !body.model) bad.push('model missing')
  if (!Number.isInteger(body.max_tokens) || body.max_tokens <= 0) bad.push('max_tokens missing')
  if (body.system !== undefined && (typeof body.system !== 'string' || !body.system.trim())) bad.push('system is empty')
  if (['tool', 'any'].includes(body.tool_choice?.type)) bad.push(`forced tool_choice ${body.tool_choice.type}`)
  const messages: Json[] = Array.isArray(body.messages) ? body.messages : []
  if (!messages.length) bad.push('no messages')
  if (messages[0] && messages[0].role !== 'user') bad.push('first message is not from the user')
  messages.forEach((m, i) => {
    if (m.role !== 'user' && m.role !== 'assistant') bad.push(`message ${i}: bad role`)
    if (!Array.isArray(m.content) || !m.content.length) bad.push(`message ${i}: empty content`)
    for (const b of Array.isArray(m.content) ? m.content : []) if (b.type === 'text' && !String(b.text ?? '').trim()) bad.push(`message ${i}: empty text block`)
  })
  for (const t of Array.isArray(body.tools) ? body.tools : []) {
    if (typeof t.name !== 'string' || !t.name) bad.push('tool without name')
    if (t.input_schema?.type !== 'object') bad.push(`tool ${t.name}: input_schema is not an object schema`)
  }
  return bad
}

const sse = (events: Json[]): string => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')

/** The stream of a call that ends in one tool call (its input split into pieces) or says one text. */
export const answer = (a: { tool: { name: string; input: Json } } | { text: string }): string =>
  sse([
    { type: 'message_start', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 3, output_tokens: 1 } } },
    ...('tool' in a
      ? [{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: a.tool.name } }, ...JSON.stringify(a.tool.input).match(/[\s\S]{1,9}/g)!.map((p) => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: p } })), { type: 'content_block_stop', index: 0 }]
      : [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: a.text } }, { type: 'content_block_stop', index: 0 }]),
    { type: 'message_delta', usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ])

/** Replaces `fetch` with a spy that answers the scripted streams in order (the last one repeats) and keeps every request body. No network. Call `restore()` afterwards. */
export const spyOnModelFetch = (...streams: string[]) => {
  const bodies: Json[] = []
  const prev = process.env.GATEWAY_URL
  process.env.GATEWAY_URL = 'http://gateway.invalid'
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(String((init as RequestInit).body)))
    return new Response(streams[Math.min(bodies.length, streams.length) - 1], { headers: { 'content-type': 'text/event-stream' } })
  })
  return {
    bodies,
    restore: () => {
      spy.mockRestore()
      if (prev === undefined) delete process.env.GATEWAY_URL
      else process.env.GATEWAY_URL = prev
    },
  }
}

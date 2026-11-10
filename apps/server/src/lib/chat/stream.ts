export type Block =
  | { type: 'text'; text: string }
  /** Stored instead of base64; resolved from the `media` collection right before each model call. */
  | { type: 'image_ref'; mediaId: number | string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type ModelMessage = { role: 'user' | 'assistant'; content: Block[] }
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> }

export type ModelEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; tokensIn: number; tokensOut: number; model?: string }

export type ModelCall = (a: { system: string; messages: ModelMessage[]; tools: ToolDef[]; noTools?: boolean; signal?: AbortSignal }) => AsyncIterable<ModelEvent>

/** Anthropic Messages API stream (`stream: true`) as normalised events: text deltas, finished tool_use blocks (input_json_delta joined and parsed at content_block_stop) and the usage of the message. Throws on an `error` event. */
export async function* parseAnthropicStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ModelEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const calls = new Map<number, { id: string; name: string; json: string }>()
  const usage = { tokensIn: 0, tokensOut: 0, model: undefined as string | undefined }
  const handle = function* (d: any): Generator<ModelEvent> {
    if (d.type === 'message_start') {
      const u = d.message?.usage ?? {}
      usage.tokensIn = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      usage.tokensOut = u.output_tokens ?? 0
      usage.model = d.message?.model
    } else if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
      calls.set(d.index, { id: d.content_block.id, name: d.content_block.name, json: '' })
    } else if (d.type === 'content_block_delta') {
      if (d.delta?.type === 'text_delta' && d.delta.text) yield { type: 'text', text: d.delta.text }
      else if (d.delta?.type === 'input_json_delta') {
        const c = calls.get(d.index)
        if (c) c.json += d.delta.partial_json ?? ''
      }
    } else if (d.type === 'content_block_stop') {
      const c = calls.get(d.index)
      if (c) {
        calls.delete(d.index)
        let input: Record<string, unknown> = {}
        try {
          input = c.json.trim() ? JSON.parse(c.json) : {}
        } catch {}
        yield { type: 'tool_use', id: c.id, name: c.name, input }
      }
    } else if (d.type === 'message_delta') {
      if (d.usage?.output_tokens != null) usage.tokensOut = d.usage.output_tokens
      if (d.usage?.input_tokens != null) usage.tokensIn = d.usage.input_tokens
    } else if (d.type === 'error') {
      throw new Error(`model stream error: ${d.error?.message ?? 'unknown'}`)
    }
  }
  let buf = ''
  const frame = (raw: string): unknown => {
    const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n')
    return data && data !== '[DONE]' ? JSON.parse(data) : null
  }
  for (;;) {
    const { done, value } = await reader.read()
    buf = (buf + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n')
    for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
      const d = frame(buf.slice(0, i))
      buf = buf.slice(i + 2)
      if (d) yield* handle(d)
    }
    if (done) break
  }
  if (buf.trim()) {
    const d = frame(buf)
    if (d) yield* handle(d)
  }
  yield { type: 'usage', ...usage }
}

/** One streaming Messages-API call through the gateway as the Workspace. */
export const gatewayChatModel = (a: { slug: string; key: string; model: string }): ModelCall =>
  async function* ({ system, messages, tools, noTools, signal }) {
    const res = await fetch(`${process.env.GATEWAY_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.key}` },
      body: JSON.stringify({ model: `ws-${a.slug}/${a.model}`, max_tokens: 4096, stream: true, system, messages, tools, ...(noTools && { tool_choice: { type: 'none' } }) }),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`chat model call failed: HTTP ${res.status}`)
    yield* parseAnthropicStream(res.body)
  }

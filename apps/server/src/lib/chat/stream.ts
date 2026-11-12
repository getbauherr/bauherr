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

export type ModelCall = (a: { system: string; messages: ModelMessage[]; tools: ToolDef[]; noTools?: boolean; /** Name of the one tool the model must call. */ forceTool?: string; signal?: AbortSignal }) => AsyncIterable<ModelEvent>

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

/** What the system prompt gets when a call must end in one tool: current Claude models (Sonnet 5.5, Opus 5.5, Fable 5.x) answer a forced `tool_choice` (`tool`, `any`) with HTTP 400, so the tool is asked for in words and the caller checks that it came. */
export const mustCall = (tool: string): string => `\n\nEnd this turn by calling the \`${tool}\` tool exactly once. Write no text before or after the call; everything you want to say goes into the tool's fields.`

/** The request body of one chat call. `forceTool` never sends a forced `tool_choice` (see `mustCall`): `auto`, one call at most, and the instruction in the system prompt. */
export const chatBody = (model: string, a: { system: string; messages: ModelMessage[]; tools: ToolDef[]; noTools?: boolean; forceTool?: string }): Record<string, unknown> => ({
  model,
  max_tokens: 16000,
  stream: true,
  system: a.forceTool ? a.system + mustCall(a.forceTool) : a.system,
  messages: a.messages,
  tools: a.tools,
  ...(a.noTools && { tool_choice: { type: 'none' } }),
  ...(a.forceTool && { tool_choice: { type: 'auto', disable_parallel_tool_use: true } }),
})

/** The provider's own words for a failed call (`error.message` of the JSON answer), shortened; never the request. */
export const upstreamReason = (body: string): string => {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown }
    const m = j.error?.message ?? j.message
    return typeof m === 'string' ? m.replace(/\s+/g, ' ').slice(0, 300) : ''
  } catch {
    return ''
  }
}

/** One streaming Messages-API call through the gateway as the Workspace. */
export const gatewayChatModel = (a: { slug: string; key: string; model: string }): ModelCall =>
  async function* ({ system, messages, tools, noTools, forceTool, signal }) {
    const res = await fetch(`${process.env.GATEWAY_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${a.key}` },
      body: JSON.stringify(chatBody(`ws-${a.slug}/${a.model}`, { system, messages, tools, noTools, forceTool })),
      signal,
    })
    if (!res.ok || !res.body) {
      const reason = upstreamReason(await res.text().catch(() => ''))
      console.error(`chat model call failed: HTTP ${res.status}${reason ? `: ${reason}` : ''}`)
      throw new Error(`chat model call failed: HTTP ${res.status}${reason ? ` (${reason})` : ''}`)
    }
    yield* parseAnthropicStream(res.body)
  }

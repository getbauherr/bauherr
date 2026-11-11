// Claude Code `Stop` hook (client side, not a Runner hook): reports this session's token usage to the factory.
// Env: BAUHERR_URL (e.g. https://bauherr.example.com), BAUHERR_AGENT_KEY (the bha_ key of the MCP connection), optional BAUHERR_SESSION (the `session` key passed to connect).
// Reads session_id and transcript_path from stdin, sums the assistant messages' usage per model (one count per message id) and posts the cumulative totals; the server stores the delta.
// Never fails the session and never prints the key.
import { readFileSync } from 'node:fs'

const url = process.env.BAUHERR_URL
const key = process.env.BAUHERR_AGENT_KEY
if (!url || !key) process.exit(0)

try {
  const input = JSON.parse(readFileSync(0, 'utf8')) as { session_id?: string; transcript_path?: string }
  if (!input.session_id || !input.transcript_path) process.exit(0)
  const messages = new Map<string, { model: string; u: Record<string, number> }>()
  let firstAt: string | undefined
  for (const line of readFileSync(input.transcript_path, 'utf8').split('\n')) {
    if (!line) continue
    let e: { type?: string; timestamp?: string; message?: { id?: string; model?: string; usage?: Record<string, number> } }
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.timestamp && (!firstAt || e.timestamp < firstAt)) firstAt = e.timestamp
    if (e.type === 'assistant' && e.message?.id && e.message.usage && e.message.model && e.message.model !== '<synthetic>') messages.set(e.message.id, { model: e.message.model, u: e.message.usage })
  }
  const models: Record<string, [number, number, number, number]> = {}
  for (const { model, u } of messages.values()) {
    const t = (models[model] ??= [0, 0, 0, 0])
    t[0] += u.input_tokens ?? 0
    t[1] += u.output_tokens ?? 0
    t[2] += u.cache_read_input_tokens ?? 0
    t[3] += u.cache_creation_input_tokens ?? 0
  }
  const res = await fetch(`${url.replace(/\/$/, '')}/api/usage`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ claudeSession: input.session_id, firstAt, models, clientKey: process.env.BAUHERR_SESSION || undefined }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) console.error(`bauherr usage hook: ${res.status} ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ''}`)
} catch (e) {
  console.error(`bauherr usage hook: ${e instanceof Error ? e.message : 'failed'}`)
}

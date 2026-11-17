// Claude Code `Stop` and `SubagentStop` hook (client side, not a Runner hook): reports this session's token usage to the factory.
// Env: BAUHERR_URL (e.g. https://bauherr.example.com), BAUHERR_AGENT_KEY (the bha_ key of the MCP connection), optional BAUHERR_SESSION (the `session` key passed to connect).
// Install with `npx bauherr hook install`. Reads session_id and transcript_path from stdin (SubagentStop: the subagent's agent_transcript_path, posted as its own `<session_id>:<agent_id>` session), sums the assistant messages' usage per model (one count per message id) and posts the cumulative totals; the server stores the delta.
// Never fails the session and never prints the key.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type Totals = Record<string, [number, number, number, number]>

export const sumTranscript = (text: string): { models: Totals; firstAt?: string } => {
  const messages = new Map<string, { model: string; u: Record<string, number> }>()
  let firstAt: string | undefined
  for (const line of text.split('\n')) {
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
  const models: Totals = {}
  for (const { model, u } of messages.values()) {
    const t = (models[model] ??= [0, 0, 0, 0])
    t[0] += u.input_tokens ?? 0
    t[1] += u.output_tokens ?? 0
    t[2] += u.cache_read_input_tokens ?? 0
    t[3] += u.cache_creation_input_tokens ?? 0
  }
  return { models, ...(firstAt && { firstAt }) }
}

type Input = { session_id?: string; transcript_path?: string; agent_id?: string; agent_transcript_path?: string }

export const reportOf = (input: Input): { claudeSession: string; path: string } | null => {
  const path = input.agent_transcript_path ?? input.transcript_path
  if (!input.session_id || !path) return null
  return { claudeSession: input.agent_transcript_path && input.agent_id ? `${input.session_id}:${input.agent_id}` : input.session_id, path }
}

const main = async () => {
  const url = process.env.BAUHERR_URL
  const key = process.env.BAUHERR_AGENT_KEY
  if (!url || !key) return
  try {
    const report = reportOf(JSON.parse(readFileSync(0, 'utf8')) as Input)
    if (!report) return
    const { models, firstAt } = sumTranscript(readFileSync(report.path, 'utf8'))
    const res = await fetch(`${url.replace(/\/$/, '')}/api/usage`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ claudeSession: report.claudeSession, firstAt, models, clientKey: process.env.BAUHERR_SESSION || undefined }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error(`bauherr usage hook: ${res.status} ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ''}`)
  } catch (e) {
    console.error(`bauherr usage hook: ${e instanceof Error ? e.message : 'failed'}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

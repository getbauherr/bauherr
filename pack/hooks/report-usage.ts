// Claude Code `Stop`/`SubagentStop` hook (client side): reports token usage. Install: `npx bauherr hook install`.
// Env: BAUHERR_URL, BAUHERR_AGENT_KEY, optional BAUHERR_SESSION. A subagent is posted as `<session_id>:<agent_id>`. Never fails the session.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export type Totals = Record<string, number[]>
type Msg = { id?: string; model?: string; usage?: Record<string, number> }; type Input = { session_id?: string; transcript_path?: string; agent_id?: string; agent_transcript_path?: string }
const KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
export const sumTranscript = (text: string): { models: Totals; firstAt?: string } => {
  const seen = new Map<string, Required<Msg>>()
  let firstAt: string | undefined
  for (const line of text.split('\n')) {
    let e: { type?: string; timestamp?: string; message?: Msg }
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.timestamp && (!firstAt || e.timestamp < firstAt)) firstAt = e.timestamp
    const m = e.message
    if (e.type === 'assistant' && m?.id && m.usage && m.model && m.model !== '<synthetic>') seen.set(m.id, m as Required<Msg>)
  }
  const models: Totals = {}
  for (const { model, usage } of seen.values()) {
    const t = (models[model] ??= [0, 0, 0, 0])
    KEYS.forEach((k, i) => (t[i] = (t[i] ?? 0) + (usage[k] ?? 0)))
  }
  return { models, ...(firstAt && { firstAt }) }
}
export const reportOf = (i: Input): { claudeSession: string; path: string } | null => {
  const path = i.agent_transcript_path ?? i.transcript_path
  if (!i.session_id || !path) return null
  return { claudeSession: i.agent_transcript_path && i.agent_id ? `${i.session_id}:${i.agent_id}` : i.session_id, path }
}
const { BAUHERR_URL: url, BAUHERR_AGENT_KEY: key, BAUHERR_SESSION: clientKey } = process.env
if (url && key && process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const r = reportOf(JSON.parse(readFileSync(0, 'utf8')) as Input)
    if (r) {
      const res = await fetch(`${url.replace(/\/$/, '')}/api/usage`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ claudeSession: r.claudeSession, ...sumTranscript(readFileSync(r.path, 'utf8')), clientKey: clientKey || undefined }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) console.error(`bauherr usage hook: ${res.status}`)
    }
  } catch (e) {
    console.error(`bauherr usage hook: ${e instanceof Error ? e.message : 'failed'}`)
  }
}

import { assertFakeAllowed } from '../fake-guard'
import type { ModelCall, ModelEvent } from './stream'

/** E2E and tests only (`CHAT_FAKE=1`, never in production): `approve #<n>` calls `approve`, `comment #<n>: <text>` calls `post_comment`, `status` calls `factory_status`, a tool result is acknowledged, anything else is echoed. */
assertFakeAllowed('CHAT_FAKE')

const usage = (text: string): ModelEvent => ({ type: 'usage', tokensIn: 10, tokensOut: Math.max(1, Math.ceil(text.length / 4)), model: 'fake' })

/** The refine engine's turn (`tools` holds `refine`): the person's text starting `refine:` carries the whole result as JSON; any other text settles the first open point with it. */
const fakeRefine = (said: string): Record<string, unknown> => {
  const open = (JSON.parse(/<state>([\s\S]*)<\/state>/.exec(said)?.[1] ?? '{}') as { points?: { id: string; status: string }[] }).points?.filter((p) => p.status === 'open') ?? []
  const text = (/<person>([\s\S]*)<\/person>/.exec(said)?.[1]?.trim() ?? '').replace(/^hold:/, '')
  if (said.includes('<recheck>')) return { reply: 'ok', settled: [], dropped: [], added: [], next: 'ask' }
  if (text.startsWith('refine:')) return JSON.parse(text.slice(7))
  const first = open[0]
  return { reply: first ? 'Noted.' : 'Noted, nothing else is open.', settled: first ? [{ id: first.id, answer: text.slice(0, 500) }] : [], dropped: [], added: [], next: open.length > 1 ? 'ask' : 'summary' }
}

/** The gate a `hold:` refine turn waits at after the first 30 characters of its reply, until `releaseFakeGate()` (the `api/chat/fake-gate` route) or an abort. On `globalThis`: route and model may sit in different bundles. */
const gates = globalThis as { __fakeGate?: { promise: Promise<void>; resolve(): void } }
export const releaseFakeGate = (): void => void gates.__fakeGate?.resolve()
const HOLD_AT = '{"reply":"'.length + 30
const CHUNK = 16

/** Every request the fake model got (model it was asked as, the last user text, image blocks in it), for e2e assertions on what a turn sent (`api/chat/fake-requests`). On `globalThis` like the gate. */
type Recorded = { model: string; text: string; images: number }
const log = globalThis as { __fakeRequests?: Recorded[] }
export const fakeRequests = (): Recorded[] => log.__fakeRequests ?? []

const run = async function* ({ messages, tools, signal }: Parameters<ModelCall>[0], model: string): AsyncGenerator<ModelEvent> {
  const sent = messages.at(-1)!
  ;(log.__fakeRequests ??= []).push({ model, text: sent.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ').slice(0, 2000), images: sent.content.filter((b) => b.type === 'image').length })
  if (tools.some((t) => t.name === 'refine')) {
    const said = messages.at(-1)!.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ')
    const { reply, ...rest } = fakeRefine(said)
    const id = `toolu_fake_refine_${messages.length}`
    const json = JSON.stringify({ reply, ...rest })
    const hold = /<person>\s*hold:/.test(said)
    // The reply streams in fixed chunks, `reply` first, like the real tool input.
    for (let at = 0; at < json.length; at += CHUNK) {
      const end = hold && at < HOLD_AT && at + CHUNK > HOLD_AT ? HOLD_AT : Math.min(at + CHUNK, json.length)
      yield { type: 'tool_delta', id, name: 'refine', json: json.slice(0, end) }
      if (end === HOLD_AT && hold) {
        let resolve!: () => void
        const gate = (gates.__fakeGate = { promise: new Promise<void>((r) => (resolve = r)), resolve })
        await Promise.race([gate.promise, new Promise((_, no) => signal?.addEventListener('abort', () => no(signal.reason), { once: true }))])
        at = end - CHUNK
      }
    }
    yield { type: 'tool_use', id, name: 'refine', input: { reply, ...rest } }
    yield { type: 'usage', tokensIn: 10, tokensOut: 20, model }
    return
  }
  const last = messages.at(-1)!
  const results = last.content.filter((b) => b.type === 'tool_result')
  if (results.length) {
    const text = `[fake] tool result: ${results.map((r) => r.content).join(' ').slice(0, 200)}`
    yield { type: 'text', text }
    yield usage(text)
    return
  }
  const said = last.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ')
  const approve = /approve #(\d+)/.exec(said)
  if (approve) {
    yield { type: 'text', text: 'Preparing the approval. ' }
    yield { type: 'tool_use', id: `toolu_fake_approve_${approve[1]}`, name: 'approve', input: { ticket: Number(approve[1]) } }
    yield usage('approve')
    return
  }
  const comment = /comment #(\d+): (.+)/.exec(said)
  if (comment) {
    yield { type: 'text', text: 'Drafting the comment. ' }
    yield { type: 'tool_use', id: `toolu_fake_comment_${comment[1]}_${messages.length}`, name: 'post_comment', input: { ticket: Number(comment[1]), body: comment[2] } }
    yield usage('comment')
    return
  }
  if (/status/i.test(said)) {
    yield { type: 'tool_use', id: 'toolu_fake_status', name: 'factory_status', input: {} }
    yield usage('status')
    return
  }
  const text = `[fake] you said: ${said.slice(0, 200)}`
  yield { type: 'text', text: text.slice(0, 8) }
  yield { type: 'text', text: text.slice(8) }
  yield usage(text)
}

/** The fake model as the named Workspace model: it answers like `fakeChatModel` but reports (and records) that name. */
export const fakeChatModelOf = (model: string): ModelCall => (a) => run(a, model)
export const fakeChatModel = fakeChatModelOf('fake-refine')

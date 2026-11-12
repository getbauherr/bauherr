import { assertFakeAllowed } from '../fake-guard'
import type { ModelCall, ModelEvent } from './stream'

/** E2E and tests only (`CHAT_FAKE=1`, never in production): `approve #<n>` calls `approve`, `comment #<n>: <text>` calls `post_comment`, `status` calls `factory_status`, a tool result is acknowledged, anything else is echoed. */
assertFakeAllowed('CHAT_FAKE')

const usage = (text: string): ModelEvent => ({ type: 'usage', tokensIn: 10, tokensOut: Math.max(1, Math.ceil(text.length / 4)), model: 'fake' })

/** The refine engine's turn (`tools` holds `refine`): the person's text starting `refine:` carries the whole result as JSON; any other text settles the first open point with it. */
const fakeRefine = (said: string): Record<string, unknown> => {
  const open = (JSON.parse(/<state>([\s\S]*)<\/state>/.exec(said)?.[1] ?? '{}') as { points?: { id: string; status: string }[] }).points?.filter((p) => p.status === 'open') ?? []
  const text = /<person>([\s\S]*)<\/person>/.exec(said)?.[1]?.trim() ?? ''
  if (text.startsWith('refine:')) return JSON.parse(text.slice(7))
  const first = open[0]
  return { reply: first ? 'Noted.' : 'Noted, nothing else is open.', settled: first ? [{ id: first.id, answer: text.slice(0, 500) }] : [], dropped: [], added: [], next: open.length > 1 ? 'ask' : 'summary' }
}

export const fakeChatModel: ModelCall = async function* ({ messages, tools }) {
  if (tools.some((t) => t.name === 'refine')) {
    const said = messages.at(-1)!.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ')
    yield { type: 'tool_use', id: `toolu_fake_refine_${messages.length}`, name: 'refine', input: fakeRefine(said) }
    yield { type: 'usage', tokensIn: 10, tokensOut: 20, model: 'fake-refine' }
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

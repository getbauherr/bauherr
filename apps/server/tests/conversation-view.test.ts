import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
})

import { shortModel } from '../src/app/(app)/lib/format'
import { partialReply } from '../src/lib/chat/stream'
import { changedFields, gatewayModel, type Draft } from '../src/lib/intake/engine'
import { footOf, messagesOf } from '../src/lib/request-conversation'
import { withoutQuestion } from '../src/lib/refine/model'
import type { CardData } from '../src/lib/intake/card'

const draft = (d: Partial<Draft> = {}): Draft => ({ title: 'T', problem: 'p', context: 'c', acceptance_criteria: ['a'], type: 'bug', links: [], ...d })
const card = (c: Partial<CardData> = {}): CardData => ({ session: 1, editable: true, sent: false, product: { id: 1, name: 'Web' }, productChoices: [], title: 'T', kind: 'bug', urgency: 'normal', urgentReason: '', problem: 'p', context: '', criteria: [], images: [], missing: [], needs: [], changed: [], parts: 0, items: [], canSend: true, fastLane: true, split: false, followUp: null, ticket: null, maxImages: 4, ...c })

describe('the model name', () => {
  it('is shown without its provider, wherever it comes from', () => {
    expect(shortModel('anthropic/claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(shortModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(shortModel('ws-acme/anthropic/claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
  })
})

describe('the question the card shows', () => {
  it('is left out of the message that asked it: the question and its "Recommended" line, nothing else', () => {
    const opening = 'Triage asked 4 questions about this Ticket. All 4 are still open.\n\nWhich file format?\nRecommended: CSV.'
    expect(withoutQuestion(opening, { title: 'Which file format?' })).toBe('Triage asked 4 questions about this Ticket. All 4 are still open.')
    expect(withoutQuestion('Which file format?\nRecommended: CSV.', { title: 'Which file format?' })).toBe('')
    expect(withoutQuestion('Ok.\nWhich file format?\nWhat should it be?', { title: 'Which file format?' })).toBe('Ok.\nWhat should it be?')
  })

  it('stays as written when it is not in the message', () => {
    expect(withoutQuestion('Noted.', { title: 'Which file format?' })).toBe('Noted.')
  })
})

describe('the streamed question of an interview turn', () => {
  it('is read from the JSON as it arrives, for `question` and still for `reply`', () => {
    expect(partialReply('{"question":"Who is aff', 'question')).toBe('Who is aff')
    expect(partialReply('{"question":"Who is affected?","options":[', 'question')).toBe('Who is affected?')
    expect(partialReply('{"quest', 'question')).toBeNull()
    expect(partialReply('{"reply":"Noted"')).toBe('Noted')
  })
})

describe('what a turn changed on the card', () => {
  it('lists the fields that differ, and all of them for a first draft', () => {
    expect(changedFields(draft(), draft({ problem: 'q', acceptance_criteria: ['a', 'b'] }))).toEqual(['problem', 'acceptance_criteria'])
    expect(changedFields(draft(), draft())).toEqual([])
    expect(changedFields(null, draft({ urgency: 'urgent', urgent_reason: 'down' }))).toEqual(['title', 'type', 'urgency', 'urgent_reason', 'problem', 'context', 'acceptance_criteria'])
  })
})

describe('the foot of the request card', () => {
  it('says what is needed, what can still be filed, and what happens next', () => {
    expect(footOf(card({ canSend: false, missing: ['what happens', 'a screenshot'] })).status).toBe('Still needed: what happens, a screenshot.')
    expect(footOf(card({ missing: ['where it happens'], canSend: true })).status).toBe('Can be filed. Still open: where it happens. The team can ask later.')
    expect(footOf(card()).status).toBe('Ready to file.')
    expect(footOf(card({ kind: 'question' })).status).toContain('files nothing')
    expect(footOf(card()).next).toMatch(/^Then: /)
    expect(footOf(card({ urgency: 'urgent' })).next).toContain('fast lane')
    expect(footOf(card({ parts: 3 })).next).toContain('3 Tickets')
    expect(footOf(card({ sent: true, ticket: 12 }))).toEqual({ status: 'Filed as #12.', next: 'The team has it.' })
  })
})

describe('the stored interview as conversation messages', () => {
  it('names the speakers, keeps the model of each answer and its usage, and falls back for an older message without a time', () => {
    const s = { id: 5, updatedAt: '2026-11-12T09:00:00.000Z', messages: [{ role: 'user', content: 'Broken', images: [3], at: '2026-11-12T08:00:00.000Z' }, { role: 'assistant', content: 'Who?', usage: { model: 'claude-sonnet-5-5', tokensIn: 10, tokensOut: 5 } }] }
    const [u, a] = messagesOf(s)
    expect(u).toMatchObject({ id: '5-0', role: 'user', text: 'Broken', speaker: { kind: 'person', at: '2026-11-12T08:00:00.000Z' }, images: [{ id: 3, url: '/intake/api/media/3' }] })
    expect(a).toMatchObject({ id: '5-1', speaker: { kind: 'assistant', role: 'Factory assistant', model: 'claude-sonnet-5-5', at: s.updatedAt }, usage: { tokensOut: 5 } })
  })
})

describe('the gateway call of an interview turn', () => {
  const sse = (events: object[]) => new Response(new ReadableStream({ start: (c) => { for (const e of events) c.enqueue(new TextEncoder().encode(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
  const call = gatewayModel({ slug: 'acme', key: 'k', model: 'anthropic/claude-sonnet-5-5' })
  const args = { system: 's', messages: [], schema: {} }

  it('streams: the JSON text reaches onPartial as it grows, the answer is the whole JSON, usage and model come from the stream', async () => {
    const seen: string[] = []
    const usage: object[] = []
    let sent: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body)
      return sse([
        { type: 'message_start', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 42 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"question":"Who is ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'affected?"}' } },
        { type: 'message_delta', usage: { output_tokens: 9 } },
        { type: 'message_stop' },
      ])
    })
    expect(await call({ ...args, onPartial: (t) => seen.push(t), onUsage: (u) => usage.push(u) })).toEqual({ question: 'Who is affected?' })
    expect(seen).toEqual(['{"question":"Who is ', '{"question":"Who is affected?"}'])
    expect(partialReply(seen[0]!, 'question')).toBe('Who is ')
    expect(usage).toEqual([{ model: 'claude-sonnet-5-5', tokensIn: 42, tokensOut: 9 }])
    expect(sent).toMatchObject({ stream: true, model: 'ws-acme/anthropic/claude-sonnet-5-5' })
  })

  it('does not stream without onPartial and still reports usage', async () => {
    const usage: object[] = []
    let sent: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body)
      return Response.json({ model: 'claude-sonnet-5-5', usage: { input_tokens: 3, output_tokens: 4 }, content: [{ type: 'text', text: '{"a":1}' }] })
    })
    expect(await call({ ...args, onUsage: (u) => usage.push(u) })).toEqual({ a: 1 })
    expect(sent).not.toHaveProperty('stream')
    expect(usage).toEqual([{ model: 'claude-sonnet-5-5', tokensIn: 3, tokensOut: 4 }])
  })

  it('stops at an abort and refuses a failed call', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: { signal: AbortSignal }) => (init.signal.aborted ? Promise.reject(init.signal.reason) : new Response('no', { status: 502 })))
    await expect(call(args)).rejects.toThrow('HTTP 502')
    const ctl = new AbortController()
    ctl.abort()
    await expect(call({ ...args, signal: ctl.signal })).rejects.toBeTruthy()
  })
})

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Payload } from 'payload'
import { DEFAULT_MODEL_BY_TIER } from '../gateway'
import type { Ctx } from '../mcp-tools'
import { decrypt } from '../secrets'
import { mediaBytes } from '../intake/media'
import { fakeChatModel } from './fake'
import { gatewayChatModel, type Block, type ModelCall, type ModelMessage } from './stream'
import { chatTools, describe, kindOf, resolveInput, runChatTool, summarize, type Card } from './tools'
import { claimPending, dropPending, finishAnswer, setContext, startAnswer, storePending, type Answer, type Who } from './threads'
import type { PageContext } from './context'

type Doc = Record<string, any>
export type ChatInput = { role: 'user' | 'assistant'; content: ({ type: 'text'; text: string } | { type: 'image'; mediaId: number | string })[] }
export type ChatEvent =
  | { type: 'context'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; kind: string; input: unknown; summary: string }
  | { type: 'tool-result'; id: string; ok: boolean; result: string }
  | { type: 'confirm'; id: string; name: string; title: string; details: Card['details']; destructive: boolean }
  | { type: 'done'; answerId: string; requiresAction?: boolean; usage: { model: string; tokensIn: number; tokensOut: number; costUsd: number | null; ms: number } }
  | { type: 'error'; message: string }

export const MAX_TOOL_ROUNDS = 8
export const CLIENT_RESULT_CHARS = 4000
const MODEL_RESULT_CHARS = 30_000
const MAX_HISTORY = 40

const skill = async (): Promise<string> => {
  const dir = process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack')
  return (await readFile(resolve(dir, 'skills/assistant/SKILL.md'), 'utf8')).replace(/^---[\s\S]*?---\s*/, '')
}

/** Skill + today + the page block; the person's words and tool results never enter it. */
const systemPrompt = async (ctx: PageContext): Promise<string> =>
  `${await skill()}\n\nToday is ${new Date().toISOString().slice(0, 10)}.\n\n<page label="${ctx.label.replace(/"/g, "'")}">\n${ctx.markdown.replace(/<\/?page/gi, '')}\n</page>`

/** The model for the person's Workspace (standard tier), or the scripted one under CHAT_FAKE / INTAKE_FAKE. */
export const chatModelFor = async (payload: Payload, workspace: number): Promise<ModelCall> => {
  if (process.env.CHAT_FAKE === '1' || process.env.INTAKE_FAKE === '1') return fakeChatModel
  const w = (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })) as Doc
  return gatewayChatModel({ slug: w.slug, key: decrypt(w.gatewayKey), model: { ...DEFAULT_MODEL_BY_TIER, ...w.modelByTier }.standard })
}

/** The client's turns as model turns; empty ones are dropped. Images stay references until the call. */
const history = (messages: ChatInput[]): ModelMessage[] =>
  messages.slice(-MAX_HISTORY).flatMap((m) => {
    const content = m.content.flatMap((p): Block[] => (p.type === 'text' ? (p.text.trim() ? [{ type: 'text', text: p.text }] : []) : [{ type: 'image_ref', mediaId: p.mediaId }]))
    return content.length ? [{ role: m.role, content }] : []
  })

/** image_ref -> base64 image of a file in the person's Workspace. */
const withImages = async (payload: Payload, workspace: number, messages: ModelMessage[]): Promise<ModelMessage[]> =>
  Promise.all(
    messages.map(async (m) => ({
      ...m,
      content: await Promise.all(
        m.content.map(async (b): Promise<Block> => {
          if (b.type !== 'image_ref') return b
          const doc = (await payload.findByID({ collection: 'media', id: b.mediaId as number, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
          if (!doc || String(typeof doc.workspace === 'object' ? doc.workspace?.id : doc.workspace) !== String(workspace)) return { type: 'text', text: '[image unavailable]' }
          return { type: 'image', source: { type: 'base64', media_type: doc.mime, data: Buffer.from(await mediaBytes(payload, doc)).toString('base64') } }
        }),
      ),
    })),
  )

type State = { messages: ModelMessage[]; results: Block[]; rounds: number }
type Env = { who: Who; ctx: Ctx; thread: Doc; page: PageContext; model: ModelCall; signal?: AbortSignal }

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v ?? null))

/** Runs one tool call to a tool_result block plus the events the client sees. */
async function* callTool(env: Env, use: { id: string; name: string; input: Record<string, unknown> }, tally: Answer['toolCalls']): AsyncGenerator<ChatEvent, Block> {
  const kind = kindOf(use.name)
  const done = (ok: boolean, text: string): Block => ({ type: 'tool_result', tool_use_id: use.id, content: shorten(text, MODEL_RESULT_CHARS), ...(!ok && { is_error: true }) })
  const emit = function* (ok: boolean, text: string): Generator<ChatEvent> {
    tally.push({ name: use.name, kind: kind ?? 'unknown', ok })
    yield { type: 'tool-result', id: use.id, ok, result: shorten(text, CLIENT_RESULT_CHARS) }
  }
  if (!kind) {
    yield { type: 'tool-call', id: use.id, name: use.name, kind: 'read', input: use.input, summary: summarize(use.name, use.input) }
    yield* emit(false, `unknown tool ${use.name}`)
    return done(false, `unknown tool ${use.name}`)
  }
  yield { type: 'tool-call', id: use.id, name: use.name, kind, input: use.input, summary: summarize(use.name, use.input) }
  try {
    const r = await resolveInput(env.ctx, use.name, use.input)
    if ('reply' in r) {
      yield* emit(r.ok, r.reply)
      return done(r.ok, r.reply)
    }
    const text = asText(await runChatTool(env.ctx, use.name, r.input))
    yield* emit(true, text)
    return done(true, text)
  } catch (e) {
    const text = (e as Error).message
    yield* emit(false, text)
    return done(false, text)
  }
}

/** The agent loop: model turn, tools, model turn; ends with an answer, or at the first `confirm` tool (stores it, emits the card). */
async function* loop(env: Env, s: State, answerId: string, t0: number, tally: Answer['toolCalls']): AsyncGenerator<ChatEvent> {
  const usage = { model: '', tokensIn: 0, tokensOut: 0 }
  const system = await systemPrompt(env.page)
  const tools = chatTools().map(({ name, description, input_schema }) => ({ name, description, input_schema }))
  let answered = false
  const finish = async (): Promise<Answer> => {
    answered = true
    const answer: Answer = { ...usage, model: usage.model || 'unknown', costUsd: null, ms: Date.now() - t0, toolCalls: tally }
    await finishAnswer(env.who, env.thread.id, answerId, answer)
    return answer
  }
  try {
    for (;;) {
      const last = s.rounds >= MAX_TOOL_ROUNDS
      const text: string[] = []
      const uses: { id: string; name: string; input: Record<string, unknown> }[] = []
      for await (const ev of env.model({ system, messages: await withImages(env.who.payload, env.who.workspace, s.messages), tools, noTools: last, signal: env.signal })) {
        if (ev.type === 'text') {
          text.push(ev.text)
          yield { type: 'delta', text: ev.text }
        } else if (ev.type === 'tool_use') uses.push(ev)
        else {
          usage.tokensIn += ev.tokensIn
          usage.tokensOut += ev.tokensOut
          usage.model = ev.model ?? usage.model
        }
      }
      const calls = last ? [] : uses
      s.messages.push({ role: 'assistant', content: [...(text.join('') ? [{ type: 'text' as const, text: text.join('') }] : []), ...calls.map((u) => ({ type: 'tool_use' as const, ...u }))] })
      if (!calls.length) break
      s.rounds++
      const results: Block[] = []
      for (const [i, use] of calls.entries()) {
        if (kindOf(use.name) !== 'confirm') {
          results.push(yield* callTool(env, use, tally))
          continue
        }
        const { id, name } = use
        let card: Card
        let canonical: Doc
        try {
          const r = await resolveInput(env.ctx, name, use.input)
          if ('reply' in r) {
            yield { type: 'tool-call', id, name, kind: 'confirm', input: use.input, summary: summarize(name, use.input) }
            yield { type: 'tool-result', id, ok: r.ok, result: shorten(r.reply, CLIENT_RESULT_CHARS) }
            results.push({ type: 'tool_result', tool_use_id: id, content: r.reply, ...(!r.ok && { is_error: true }) })
            continue
          }
          canonical = r.input
          card = await describe(name, canonical, env.ctx)
        } catch (e) {
          yield { type: 'tool-call', id, name, kind: 'confirm', input: use.input, summary: summarize(name, use.input) }
          yield { type: 'tool-result', id, ok: false, result: shorten((e as Error).message, CLIENT_RESULT_CHARS) }
          results.push({ type: 'tool_result', tool_use_id: id, content: (e as Error).message, is_error: true })
          continue
        }
        const rest = calls.slice(i + 1).map((u): Block => ({ type: 'tool_result', tool_use_id: u.id, content: 'skipped: another action awaits the person\'s confirmation; call again if still needed', is_error: true }))
        const stored = await storePending(env.who, env.thread.id, { toolCallId: id, name, kind: 'confirm', input: canonical, summary: card.title, issuedAt: new Date().toISOString(), card, state: { messages: s.messages, results: [...results, ...rest], rounds: s.rounds } })
        if (!stored) {
          yield { type: 'error', message: 'another action already awaits confirmation in this chat' }
          return
        }
        yield { type: 'tool-call', id, name, kind: 'confirm', input: canonical, summary: card.title }
        yield { type: 'confirm', id, name, title: card.title, details: card.details, destructive: !!card.destructive }
        const { toolCalls: _t, ...u } = await finish()
        yield { type: 'done', answerId, requiresAction: true, usage: { model: u.model, tokensIn: u.tokensIn, tokensOut: u.tokensOut, costUsd: u.costUsd, ms: u.ms } }
        return
      }
      s.messages.push({ role: 'user', content: results })
    }
    const { toolCalls: _t, ...u } = await finish()
    yield { type: 'done', answerId, usage: { model: u.model, tokensIn: u.tokensIn, tokensOut: u.tokensOut, costUsd: u.costUsd, ms: u.ms } }
  } catch (e) {
    if (env.signal?.aborted) return
    yield { type: 'error', message: (e as Error).message }
  } finally {
    if (!answered) await finish().catch(() => {})
  }
}

const envOf = (a: { payload: Payload; user: Doc; workspace: number; thread: Doc; page: PageContext; model: ModelCall; signal?: AbortSignal }): Env => ({
  who: { payload: a.payload, user: a.user, workspace: a.workspace },
  ctx: { payload: a.payload, user: a.user, actor: { kind: 'human' }, workspace: a.workspace },
  thread: a.thread,
  page: a.page,
  model: a.model,
  signal: a.signal,
})

/** One chat turn: the page context, then the answer as events. The model sees the client's text and images as user turns only; a pending confirmation of an earlier turn is dropped. */
export async function* runChat(a: { payload: Payload; user: Doc; workspace: number; thread: Doc; messages: ChatInput[]; context: PageContext & { path: string }; model: ModelCall; signal?: AbortSignal }): AsyncGenerator<ChatEvent> {
  const env = envOf({ ...a, page: a.context })
  yield { type: 'context', label: a.context.label }
  await setContext(env.who, a.thread.id, { path: a.context.path, label: a.context.label })
  await dropPending(env.who, a.thread.id)
  const answerId = await startAnswer(env.who, a.thread.id)
  yield* loop(env, { messages: history(a.messages), results: [], rounds: 0 }, answerId, Date.now(), [])
}

/**
 * The person's answer to the pending card. Resolves to null when there is nothing to confirm: no pending call, another id, or already answered (the claim clears it in one statement, so a double click runs once). On approve it runs EXACTLY the stored name and input as the confirming person; on decline the model is told.
 */
export const resumeChat = async (a: { payload: Payload; user: Doc; workspace: number; thread: Doc; toolCallId: string; approved: boolean; reason?: string; context: PageContext; model: ModelCall; signal?: AbortSignal }): Promise<AsyncGenerator<ChatEvent> | null> => {
  const env = envOf({ ...a, page: a.context })
  const pending = await claimPending(env.who, a.thread.id, a.toolCallId)
  if (!pending) return null
  return (async function* () {
    yield { type: 'context', label: a.context.label }
    const tally: Answer['toolCalls'] = []
    const t0 = Date.now()
    let result: Block
    if (a.approved) {
      try {
        const text = asText(await runChatTool(env.ctx, pending.name, pending.input))
        tally.push({ name: pending.name, kind: 'confirm', ok: true })
        yield { type: 'tool-result', id: pending.toolCallId, ok: true, result: shorten(text, CLIENT_RESULT_CHARS) }
        result = { type: 'tool_result', tool_use_id: pending.toolCallId, content: shorten(text, MODEL_RESULT_CHARS) }
      } catch (e) {
        const text = (e as Error).message
        tally.push({ name: pending.name, kind: 'confirm', ok: false })
        yield { type: 'tool-result', id: pending.toolCallId, ok: false, result: shorten(text, CLIENT_RESULT_CHARS) }
        result = { type: 'tool_result', tool_use_id: pending.toolCallId, content: text, is_error: true }
      }
    } else {
      const text = `declined by the person${a.reason?.trim() ? `: ${a.reason.trim().slice(0, 500)}` : ''}`
      tally.push({ name: pending.name, kind: 'confirm', ok: false })
      yield { type: 'tool-result', id: pending.toolCallId, ok: false, result: text }
      result = { type: 'tool_result', tool_use_id: pending.toolCallId, content: text, is_error: true }
    }
    const state = pending.state as State
    const answerId = await startAnswer(env.who, a.thread.id)
    yield* loop(env, { messages: [...state.messages, { role: 'user', content: [...state.results, result] }], results: [], rounds: state.rounds }, answerId, t0, tally)
  })()
}

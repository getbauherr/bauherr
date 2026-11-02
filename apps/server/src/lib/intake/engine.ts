import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const MAX_QUESTIONS = 6
export const MAX_USER_MESSAGES = 12
export const MAX_MESSAGE_CHARS = 2000
const SCREEN = /\b(page|screen|button|error|layout|seite|bildschirm|knopf|schaltfl[aä]che|fehler)\b/i

export type Draft = { problem: string; context: string; acceptance_criteria: string[]; type: 'bug' | 'feature' | 'question'; severity?: 'low' | 'medium' | 'high'; links: string[] }
export type Message = { role: 'user' | 'assistant'; content: string }
export type Turn = { question: string; options?: { label: string; recommended?: boolean }[]; draft: Draft; needsScreenshot: boolean; missing: string[] }
export type Session = { messages: Message[]; draft: Draft | null; screenshots?: number }

export const emptyDraft = (): Draft => ({ problem: '', context: '', acceptance_criteria: [], type: 'feature', links: [] })

export const TURN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['question', 'draft', 'needsScreenshot', 'missing'],
  properties: {
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string' }, recommended: { type: 'boolean' } } } },
    draft: {
      type: 'object',
      additionalProperties: false,
      required: ['problem', 'context', 'acceptance_criteria', 'type', 'links'],
      properties: {
        problem: { type: 'string' },
        context: { type: 'string' },
        acceptance_criteria: { type: 'array', items: { type: 'string' } },
        type: { enum: ['bug', 'feature', 'question'] },
        severity: { enum: ['low', 'medium', 'high'] },
        links: { type: 'array', items: { type: 'string' } },
      },
    },
    needsScreenshot: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
}

const userText = (s: Session) => s.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
export const questionsAsked = (s: Session): number => s.messages.filter((m) => m.role === 'assistant').length

/** True when the request talks about something on a screen (the model's flag or the user's words). */
export const refersToScreen = (s: Session, modelFlag = false): boolean => modelFlag || SCREEN.test(userText(s))

/**
 * Engine-side completeness, never self-scored by the model: problem, context, >= 2 criteria, and a screenshot when the request refers to a screen.
 * `exhausted` (question cap reached) lets the person submit what exists; the gaps go under "Open".
 */
export const readiness = (draft: Draft | null, hasScreenshot: boolean, refers: boolean, asked: number): { ready: boolean; exhausted: boolean; missing: string[] } => {
  const missing = [
    ...(draft?.problem.trim() ? [] : ['problem']),
    ...(draft?.context.trim() ? [] : ['context']),
    ...((draft?.acceptance_criteria.filter((c) => c.trim()).length ?? 0) >= 2 ? [] : ['acceptance_criteria']),
    ...(refers && !hasScreenshot ? ['screenshot'] : []),
  ]
  return { ready: !missing.length, exhausted: asked >= MAX_QUESTIONS, missing }
}

const prompt = async (): Promise<string> =>
  (await readFile(resolve(process.cwd(), '../../pack/skills/intake/SKILL.md'), 'utf8')).replace(/^---[\s\S]*?---\s*/, '')

export type ModelCall = (a: { system: string; messages: Message[]; schema: object }) => Promise<unknown>

/** One Messages-API call through the gateway as the Workspace; the answer is the schema-enforced JSON text. */
export const gatewayModel = (a: { slug: string; key: string; model: string }): ModelCall => async ({ system, messages, schema }) => {
  const res = await fetch(`${process.env.GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.key}` },
    body: JSON.stringify({ model: `ws-${a.slug}/${a.model}`, max_tokens: 1500, system, messages, output_config: { format: { type: 'json_schema', schema } } }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`intake model call failed: HTTP ${res.status}`)
  const text = ((await res.json()) as { content: { type: string; text?: string }[] }).content.find((c) => c.type === 'text')?.text
  return JSON.parse(text ?? '')
}

const list = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 500)).filter(Boolean).slice(0, max) : [])

/** Validates the model's turn; throws on anything that is not the schema's shape. */
export const normalizeTurn = (raw: any): Turn => {
  const d = raw?.draft
  if (!raw || typeof raw.question !== 'string' || !raw.question.trim() || !d || !['bug', 'feature', 'question'].includes(d.type)) throw new Error('intake model returned an invalid turn')
  return {
    question: raw.question.trim().slice(0, 500),
    options: Array.isArray(raw.options) ? raw.options.slice(0, 6).map((o: any) => ({ label: String(o.label).slice(0, 100), recommended: o.recommended === true })) : undefined,
    draft: {
      problem: String(d.problem ?? '').trim().slice(0, 1000),
      context: String(d.context ?? '').trim().slice(0, 2000),
      acceptance_criteria: list(d.acceptance_criteria, 10),
      type: d.type,
      ...(['low', 'medium', 'high'].includes(d.severity) && { severity: d.severity }),
      links: list(d.links, 10),
    },
    needsScreenshot: raw.needsScreenshot === true,
    missing: list(raw.missing, 10),
  }
}

/** Caps the user's text; the person's words go only in the user turn, never into the system prompt. */
export const checkMessage = (s: Session, text: string): void => {
  if (!text.trim()) throw new Error('empty message')
  if (text.length > MAX_MESSAGE_CHARS) throw new Error(`message longer than ${MAX_MESSAGE_CHARS} characters`)
  if (s.messages.filter((m) => m.role === 'user').length >= MAX_USER_MESSAGES) throw new Error('message limit reached')
}

/** Adds the user's message, asks the model for the next single question and the updated draft, and returns the new session state. */
export const nextTurn = async (s: Session, text: string, model: ModelCall): Promise<{ session: Session; turn: Turn; ready: boolean; exhausted: boolean; missing: string[] }> => {
  checkMessage(s, text)
  if (questionsAsked(s) >= MAX_QUESTIONS) throw new Error('question limit reached')
  const messages: Message[] = [...s.messages, { role: 'user', content: text }]
  const turn = normalizeTurn(await model({ system: await prompt(), messages, schema: TURN_SCHEMA }))
  const session: Session = { ...s, messages: [...messages, { role: 'assistant', content: turn.question }], draft: turn.draft }
  const r = readiness(turn.draft, (s.screenshots ?? 0) > 0, refersToScreen(session, turn.needsScreenshot), questionsAsked(session))
  return { session, turn, ...r }
}

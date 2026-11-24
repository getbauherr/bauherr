import type { Payload } from 'payload'
import { z } from 'zod'
import type { RetroModel } from '../core/retro/model'
import { assertFakeAllowed } from './fake-guard'
import { tierModels } from './gateway'
import { decrypt } from './secrets'

const workspaceRow = z.looseObject({ id: z.number(), gatewayKey: z.string().nullish() })

const MAX_TOKENS = 4000
const TIMEOUT_MS = 120_000

export class ModelUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export const gatewayModel =
  (payload: Payload): RetroModel =>
  async (workspace, system, turns) => {
    const url = process.env.GATEWAY_URL
    if (!url) throw new ModelUnavailable('The model gateway is not set up: connect a model provider first.')
    const found = await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })
    const ws = workspaceRow.parse(found)
    const key = ws.gatewayKey
    if (!key) throw new ModelUnavailable('This Workspace has no gateway key yet.')
    const model = (await tierModels(payload, ws)).standard
    const res = await fetch(`${url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${decrypt(key)}` },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages: turns }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new ModelUnavailable(`The model did not answer (HTTP ${res.status}). Try again.`)
    const body = (await res.json()) as { content?: { type: string; text?: string }[] }
    return body.content?.find((part) => part.type === 'text')?.text ?? ''
  }

assertFakeAllowed('BAUHERR_E2E_FAKE_FORGE')
const fake = process.env.BAUHERR_E2E_FAKE_FORGE === '1'

export const retroModel = async (payload: Payload): Promise<RetroModel> =>
  fake ? (await import('./fake-retro-model')).fakeRetroModel : gatewayModel(payload)

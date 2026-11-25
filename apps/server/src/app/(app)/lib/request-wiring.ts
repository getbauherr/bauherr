import type { Payload } from 'payload'
import { WriteError } from '../../../core/forge/errors'
import { createWriter } from '../../../core/forge/writer'
import { RequestError } from '../../../core/requests/errors'
import type { SendDeps } from '../../../core/requests/send'
import type { TurnDeps } from '../../../core/requests/turn'
import { requestSkill } from '../../../lean'
import { secret } from '../../../lib/secrets'
import { publicUrl } from '../../../lib/oidc'
import { ModelUnavailable } from '../../../lib/retro-model'
import { requestModel } from '../../../lib/request-model'

export const turnDeps = async (payload: Payload): Promise<TurnDeps> => ({
  model: await requestModel(payload),
  skill: requestSkill,
})

export const sendDeps = (payload: Payload): SendDeps => ({
  writer: createWriter(payload),
  origin: publicUrl(),
  key: secret('PAYLOAD_SECRET'),
})

export const refusal = (error: unknown): Response => {
  if (error instanceof RequestError) return Response.json({ error: error.message }, { status: 400 })
  if (error instanceof ModelUnavailable || error instanceof WriteError) {
    return Response.json({ error: error.message }, { status: 502 })
  }
  throw error
}

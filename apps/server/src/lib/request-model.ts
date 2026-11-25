import type { Payload } from 'payload'
import type { RequestModel } from '../core/requests/turn'
import { assertFakeAllowed } from './fake-guard'
import { gatewayModel } from './retro-model'

assertFakeAllowed('BAUHERR_E2E_FAKE_FORGE')
const fake = process.env.BAUHERR_E2E_FAKE_FORGE === '1'

export const requestModel = async (payload: Payload): Promise<RequestModel> =>
  fake ? (await import('./fake-request-model')).fakeRequestModel : gatewayModel(payload)

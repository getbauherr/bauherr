import type { Payload } from 'payload'
import type { RetroModel } from '../../../core/retro/model'
import { assertFakeAllowed } from '../../../lib/fake-guard'
import { gatewayModel } from './retro-model'

assertFakeAllowed('BAUHERR_E2E_FAKE_FORGE')
const fake = process.env.BAUHERR_E2E_FAKE_FORGE === '1'

export const steerModel = async (payload: Payload): Promise<RetroModel> =>
  fake ? (await import('./fake-steer-model')).fakeSteerModel : gatewayModel(payload)

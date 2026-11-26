import type { Payload } from 'payload'
import { classify, type Classified } from '../intake/candidates'

export type ClassifyFilter = { workspace: number; product?: number; now: Date }

export const classifiedIn = (payload: Payload, filter: ClassifyFilter): Promise<Classified[]> =>
  classify(payload, filter.now, filter.product ?? null, filter.workspace)

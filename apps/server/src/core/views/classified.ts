import type { Payload } from 'payload'
import { classify, type Classified } from '../intake/candidates'

export type ClassifyFilter = { workspace: number; product?: number; now: Date }

export const classifiedIn = async (payload: Payload, filter: ClassifyFilter): Promise<Classified[]> =>
  (await classify(payload, filter.now, filter.product ?? null)).filter(
    ({ candidate }) => candidate.workspace === filter.workspace,
  )

import type { Payload } from 'payload'

export type MirrorItemInput = { source: number; kind: 'issue' | 'pr'; number: number }

export const MIRROR_ITEM = 'mirror-item'
export const HOOK_QUEUE = 'poll'

export const queueItem = async (payload: Payload, input: MirrorItemInput): Promise<void> => {
  await payload.jobs.queue({ task: MIRROR_ITEM, queue: HOOK_QUEUE, input })
}

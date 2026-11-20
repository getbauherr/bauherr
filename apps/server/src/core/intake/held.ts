import type { Payload } from 'payload'
import { classify } from './candidates'

export type HeldItem = {
  itemId: number
  repo: string
  number: number
  title: string
  url: string
  author: string
  reason: string
}

export const heldItems = async (payload: Payload, product: number, now: Date): Promise<HeldItem[]> =>
  (await classify(payload, now, product))
    .filter(({ selection }) => selection.action === 'hold')
    .map(({ candidate, selection }) => ({
      itemId: candidate.itemId,
      repo: candidate.repo,
      number: candidate.number,
      title: candidate.title,
      url: candidate.url,
      author: candidate.item.author,
      reason: selection.reason,
    }))

import { GithubError, type TicketSource } from '@bauherr/adapters'
import { WriteError } from '../forge/errors'
import { forgeAdd, forgeRemove } from './forge-ops'
import { forgeNumbers } from './sync'
import type { ForgeField, RelationType } from './types'

export class ForgeUnavailable extends WriteError {}

type Link = { field: ForgeField; mine: number; other: number }

const serverError = (error: unknown): error is GithubError => error instanceof GithubError && error.status >= 500

const isLinked = async (tickets: TicketSource, type: RelationType, link: Link): Promise<boolean> =>
  forgeNumbers(await tickets.get(String(link.mine)), type).includes(link.other)

export const syncForgeLink = async (
  tickets: TicketSource,
  type: RelationType,
  link: Link,
  change: 'add' | 'remove',
): Promise<void> => {
  const wanted = change === 'add'
  if ((await isLinked(tickets, type, link)) === wanted) return
  const write = change === 'add' ? forgeAdd : forgeRemove
  for (const attempt of [1, 2]) {
    try {
      return await write(tickets, link.field, String(link.mine), String(link.other))
    } catch (error) {
      if (!serverError(error)) throw error
      if ((await isLinked(tickets, type, link)) === wanted) return
      if (attempt === 2) {
        throw new ForgeUnavailable(
          `GitHub did not take the link (error ${error.status}) twice. Nothing was saved; try again in a minute.`,
        )
      }
    }
  }
}

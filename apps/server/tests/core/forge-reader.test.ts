import { describe, expectTypeOf, it } from 'vitest'
import type { ForgeReader, ReadForge, ReadTickets } from '../../src/core/forge/reader'

describe('the read-only forge view', () => {
  it('offers the read methods of the sync and no write method', () => {
    expectTypeOf<keyof ReadTickets>().toEqualTypeOf<'list' | 'get' | 'poll' | 'listComments'>()
    expectTypeOf<keyof ReadForge>().toEqualTypeOf<
      | 'listOpenPullRequests'
      | 'getPullRequest'
      | 'getBranch'
      | 'listChecks'
      | 'getRepository'
      | 'requiredChecks'
      | 'isBranchProtected'
      | 'fileExists'
      | 'getFile'
      | 'countIssueForms'
      | 'listFiles'
      | 'listTags'
      | 'releaseByTag'
    >()
    expectTypeOf<ReadTickets>().not.toHaveProperty('comment')
    expectTypeOf<ReadTickets>().not.toHaveProperty('addLabels')
    expectTypeOf<ReadTickets>().not.toHaveProperty('close')
    expectTypeOf<ReadForge>().not.toHaveProperty('mergePullRequest')
    expectTypeOf<ReadForge>().not.toHaveProperty('openPullRequest')
    expectTypeOf<ForgeReader['forge']>().toEqualTypeOf<ReadForge>()
  })
})

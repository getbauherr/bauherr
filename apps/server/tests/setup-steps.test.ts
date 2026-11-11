import { expect, it } from 'vitest'
import { needsSetup, shownStep, stepsOf, type SetupFacts } from '../src/app/(app)/lib/setup-steps'

const none: SetupFacts = { forgeVerified: false, product: false, teamApplied: false, sessionEver: false, llmConnection: false, sessionSkipped: false, ticket: false }
const done = (f: Partial<SetupFacts>) => stepsOf({ ...none, ...f }).steps.filter((s) => s.done).map((s) => s.id)

it('a fresh Workspace has nothing done; an unverified Connection is not the forge step', () => {
  expect(done({})).toEqual([])
  expect(stepsOf(none)).toMatchObject({ count: 0, complete: false })
})

it('each fact completes exactly its step', () => {
  expect(done({ forgeVerified: true })).toEqual(['forge'])
  expect(done({ product: true })).toEqual(['product'])
  expect(done({ teamApplied: true })).toEqual(['team'])
  expect(done({ ticket: true })).toEqual(['request'])
})

it('the session step is met by a session, a Runner (LLM Connection) or a skip, and by nothing else', () => {
  expect(done({ sessionEver: true })).toEqual(['session'])
  expect(done({ llmConnection: true })).toEqual(['session'])
  expect(done({ sessionSkipped: true })).toEqual(['session'])
})

it('the wizard is complete when the three required steps are done; the optional ones only count', () => {
  const required = { forgeVerified: true, product: true, ticket: true }
  expect(stepsOf({ ...none, ...required })).toMatchObject({ count: 3, complete: true })
  expect(stepsOf({ ...none, forgeVerified: true, product: true })).toMatchObject({ count: 2, complete: false })
  expect(stepsOf({ ...none, ...required, teamApplied: true, sessionEver: true })).toMatchObject({ count: 5, complete: true })
  expect(stepsOf({ ...none, teamApplied: true, sessionEver: true })).toMatchObject({ count: 2, complete: false })
})

it('a reload resumes at the first undone step; done steps can be revisited, later ones cannot', () => {
  const steps = stepsOf({ ...none, forgeVerified: true, product: true }).steps
  expect(shownStep(steps, undefined)).toBe('team')
  expect(shownStep(steps, 'forge')).toBe('forge')
  expect(shownStep(steps, 'team')).toBe('team')
  expect(shownStep(steps, 'request')).toBe('team')
  expect(shownStep(steps, 'nope')).toBe('team')
  const all = stepsOf({ forgeVerified: true, product: true, teamApplied: true, sessionEver: true, llmConnection: false, sessionSkipped: false, ticket: true }).steps
  expect(shownStep(all, undefined)).toBeUndefined()
  expect(shownStep(all, 'session')).toBe('session')
})

it('only an Admin of a Workspace without a Product is sent to /setup', () => {
  expect(needsSetup(true, 0)).toBe(true)
  expect(needsSetup(true, 1)).toBe(false)
  expect(needsSetup(false, 0)).toBe(false)
})

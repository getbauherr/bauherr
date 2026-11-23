import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { tierIn } from '../../src/core/run/tiers'
import { MODULES, skillFor, tierFor } from '../../src/lean'
import { openMcp, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_context_pack', MODULES)
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})
beforeEach(async () => {
  await m.e.drain()
})

const pack = z.object({
  status: z.literal('work'),
  context: z.object({
    stage: z.string(),
    model: z.object({ tier: z.string() }),
    skill: z.string().nullable(),
    facts: z.object({ missing: z.array(z.string()) }).nullable(),
    agentsFile: z.object({ text: z.string(), cut: z.boolean() }).nullable(),
    statements: z.array(z.unknown()),
    similar: z.array(z.unknown()),
  }),
})

const claimWith = async (skills: (stage: string) => Promise<string | null>) => {
  const { agent } = m.agent(m.alpha)
  const contexts = { agent: { ...agent, deps: { ...agent.deps, skills: (stage: string) => skills(stage) } } }
  const { session } = z.object({ session: z.string() }).parse(await m.call('connect', { role: 'builder' }, contexts))
  return pack.parse(await m.call('next_work', { session }, contexts))
}

describe('the context pack', () => {
  it('delivers the skill text of the stage and the intake facts to an intake run', async () => {
    await m.begin()
    const work = await claimWith((stage) => Promise.resolve(`skill of ${stage}`))
    expect(work.context.stage).toBe('intake')
    expect(work.context.skill).toBe('skill of intake')
    expect(work.context.facts?.missing).toEqual(['what happened', 'what was expected', 'steps to reproduce', 'where'])
  })

  it('returns the repository file, the statements and the similar tickets, empty when there are none', async () => {
    await m.begin()
    const work = await claimWith(() => Promise.resolve(null))
    expect(work.context).toMatchObject({ agentsFile: null, statements: [], similar: [] })
  })

  it('has no skill when the loader finds none', async () => {
    await m.begin()
    const work = await claimWith(() => Promise.resolve(null))
    expect(work.context.skill).toBeNull()
  })
})

describe('the skill loader', () => {
  it('reads the skill of every stage that has a module and none for the others', async () => {
    for (const stage of ['intake', 'brief', 'build', 'verify'] as const) {
      expect(await skillFor(stage)).toMatch(/^# \w+/)
    }
    expect(await skillFor('ship')).toBeNull()
  })
})

describe('the model tier', () => {
  it('names the tier of the role in pack/pack.yaml and standard for a role without one', async () => {
    expect(await tierFor('builder')).toBe('standard')
    expect(await tierFor('verifier')).toBe('strong')
    expect(await tierFor('reviewer')).toBe('strong')
    expect(tierIn({ roles: { builder: { tier: 'cheap' } } }, 'builder')).toBe('cheap')
    expect(tierIn({ roles: { builder: { tier: 'cheap' } } }, 'verifier')).toBe('standard')
    expect(tierIn({}, 'builder')).toBe('standard')
    expect(() => tierIn({ roles: { builder: { tier: 'huge' } } }, 'builder')).toThrow()
  })

  it('carries the tier in the pack of a run', async () => {
    await m.begin()
    const { agent } = m.agent(m.alpha)
    const contexts = { agent: { ...agent, deps: { ...agent.deps, tiers: () => Promise.resolve('cheap' as const) } } }
    const { session } = z.object({ session: z.string() }).parse(await m.call('connect', { role: 'builder' }, contexts))
    expect(pack.parse(await m.call('next_work', { session }, contexts)).context.model).toEqual({ tier: 'cheap' })
    await m.e.drain()
    await m.begin()
    const plain = await claimWith(() => Promise.resolve(null))
    expect(plain.context.model).toEqual({ tier: 'standard' })
  })
})

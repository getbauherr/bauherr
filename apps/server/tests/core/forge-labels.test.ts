import { describe, expect, it } from 'vitest'
import { assertNamespaced, disclosed, DISCLOSURE, hashBody, planStageLabels } from '../../src/core/forge/disclosure'
import { LabelOutsideNamespace } from '../../src/core/forge/errors'

describe('planStageLabels', () => {
  it('adds the new stage label, removes the other stage labels and leaves every other label alone', () => {
    const plan = planStageLabels(['bug', 'bauherr:stage:intake', 'bauherr:approved:plan', 'stage:other'], 'brief')
    expect(plan.add).toEqual(['bauherr:stage:brief'])
    expect(plan.remove).toEqual(['bauherr:stage:intake'])
    expect(plan.next).toEqual(['bug', 'bauherr:approved:plan', 'stage:other', 'bauherr:stage:brief'])
  })

  it('changes nothing when the stage label is already the only one', () => {
    const plan = planStageLabels(['bug', 'bauherr:stage:build'], 'build')
    expect(plan).toEqual({ add: [], remove: [], next: ['bug', 'bauherr:stage:build'] })
  })

  it('refuses a label outside the bauherr namespace', () => {
    expect(() => assertNamespaced(['bauherr:stage:build', 'bug'])).toThrow(LabelOutsideNamespace)
    expect(() => assertNamespaced(['bauherr:stage:build'])).not.toThrow()
  })
})

describe('disclosed', () => {
  it('puts the disclosure line first, exactly once', () => {
    expect(disclosed('hello')).toBe(`${DISCLOSURE}\n\nhello`)
    expect(disclosed(`${DISCLOSURE}\n\nhello`)).toBe(`${DISCLOSURE}\n\nhello`)
    expect(disclosed('')).toBe(`${DISCLOSURE}\n\n`)
  })

  it('hashes the same text to the same value', () => {
    expect(hashBody('a')).toBe(hashBody('a'))
    expect(hashBody('a')).not.toBe(hashBody('b'))
  })
})

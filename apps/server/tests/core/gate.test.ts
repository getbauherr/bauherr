import { describe, expect, it } from 'vitest'
import { briefGate, fingerprint } from '../../src/core/lifecycle'
import { answered, briefed, decision, source } from './fixtures'

const config = { riskAreas: ['security', 'billing'] }
const risk = (door: 'one-way' | 'two-way', areas: string[] = []) => ({ door, areas, rollback: 'revert' })

describe('briefGate', () => {
  it('lets a plain, internal, current ticket through', () => {
    expect(briefGate(briefed(), config)).toBeNull()
    expect(briefGate(briefed({ decisions: [decision(1, answered)] }), config)).toBeNull()
  })

  it('flags a decision without an answer', () => {
    expect(briefGate(briefed({ decisions: [decision(1, answered), decision(2)] }), config)).toBe('open-decision')
  })

  it('flags a one-way door', () => {
    expect(briefGate(briefed({ risk: risk('one-way') }), config)).toBe('one-way-door')
  })

  it('flags a touched risk area, and no other area', () => {
    expect(briefGate(briefed({ risk: risk('two-way', ['ui', 'billing']) }), config)).toBe('risk-area')
    expect(briefGate(briefed({ risk: risk('two-way', ['ui']) }), config)).toBeNull()
    expect(briefGate(briefed({ risk: risk('two-way', ['security']) }), { riskAreas: [] })).toBeNull()
  })

  it('flags a change a user will see, whatever the risk says', () => {
    expect(briefGate(briefed({ visible: true }), config)).toBe('visible-change')
    expect(briefGate(briefed({ visible: false }), config)).toBeNull()
  })

  it('flags a backlog issue', () => {
    expect(briefGate(briefed({ source: { ...source, backlog: true } }), config)).toBe('backlog')
  })

  it('flags an external feature or change, not an external bug or chore', () => {
    const external = { ...source, external: true }
    expect(briefGate(briefed({ source: external, type: 'feature' }), config)).toBe('external-request')
    expect(briefGate(briefed({ source: external, type: 'change' }), config)).toBe('external-request')
    expect(briefGate(briefed({ source: external, type: 'bug' }), config)).toBeNull()
    expect(briefGate(briefed({ source: external, type: 'chore' }), config)).toBeNull()
  })

  it('gives the first reason in priority order when several apply', () => {
    const all = briefed({
      decisions: [decision(1)],
      risk: risk('one-way', ['security']),
      source: { ...source, backlog: true, external: true },
      type: 'feature',
    })
    expect(briefGate(all, config)).toBe('open-decision')
    expect(briefGate({ ...all, decisions: [] }, config)).toBe('one-way-door')
    expect(briefGate({ ...all, decisions: [], risk: risk('two-way', ['security']) }, config)).toBe('risk-area')
    expect(briefGate({ ...all, decisions: [], risk: risk('two-way'), visible: true }, config)).toBe('visible-change')
    expect(briefGate({ ...all, decisions: [], risk: risk('two-way') }, config)).toBe('backlog')
    const onlyExternal = { ...all, decisions: [], risk: risk('two-way'), source: { ...source, external: true } }
    expect(briefGate(onlyExternal, config)).toBe('external-request')
  })

  it('does not need a risk to apply the later rules', () => {
    expect(briefGate(briefed({ risk: null, source: { ...source, backlog: true } }), config)).toBe('backlog')
  })
})

describe('fingerprint', () => {
  it('ignores key order at every depth', () => {
    expect(fingerprint({ a: 1, b: { c: [1, { x: 1, y: 2 }], d: null } })).toBe(
      fingerprint({ b: { d: null, c: [1, { y: 2, x: 1 }] }, a: 1 }),
    )
  })

  it('changes with any value, with array order and with type', () => {
    const base = fingerprint({ a: [1, 2] })
    expect(fingerprint({ a: [2, 1] })).not.toBe(base)
    expect(fingerprint({ a: [1, 3] })).not.toBe(base)
    expect(fingerprint({ a: ['1', 2] })).not.toBe(base)
    expect(fingerprint({ b: [1, 2] })).not.toBe(base)
  })

  it('gives a hex digest and the same answer twice', () => {
    expect(fingerprint('x')).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }))
  })
})

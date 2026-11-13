import { describe, expect, it } from 'vitest'
import { executorOf, type ExecutorFacts } from '../src/lib/executors'

const now = Date.parse('2026-11-13T12:00:00Z')
const deploy = { configured: true, lastAt: '2026-11-13T11:43:00Z', ci: 'GitHub Actions', href: '/settings/products/1' }
const facts = (f: Partial<ExecutorFacts> = {}): ExecutorFacts => ({ waiting: 0, deploy, now, ...f })
const role = (r: Partial<NonNullable<ExecutorFacts['role']>> = {}) => ({ id: 'engineer', title: 'Software engineer', working: 0, idle: 0, connected: 0, ...r })

describe('executorOf', () => {
  it('a stage with a role and connected sessions says who works and who is idle', () => {
    expect(executorOf({ name: 'build', kind: 'build', role: 'engineer' }, facts({ role: role({ working: 2, idle: 1, connected: 3 }) }))).toEqual({ line: 'Software engineer · 2 working · 1 idle', action: null, cannotRun: false })
  })
  it('a stage with a role and no session names the waiting Runs and offers to connect one', () => {
    expect(executorOf({ name: 'build', kind: 'build', role: 'engineer' }, facts({ role: role(), waiting: 3 }))).toEqual({ line: 'Software engineer · none connected, 3 Runs waiting', action: { label: 'Connect a Software engineer', href: '/team?role=engineer' }, cannotRun: true })
    expect(executorOf({ name: 'build', kind: 'build', role: 'engineer' }, facts({ role: role(), waiting: 1 }))?.line).toBe('Software engineer · none connected, 1 Run waiting')
  })
  it('the release stage runs on the Product CI: last deploy when configured, a configure action when not', () => {
    expect(executorOf({ name: 'release', kind: 'release' }, facts())).toEqual({ line: 'GitHub Actions · last deploy 17 min ago', action: null, cannotRun: false })
    expect(executorOf({ name: 'release', kind: 'release' }, facts({ deploy: { ...deploy, lastAt: null } }))?.line).toBe('GitHub Actions · no deploy reported yet')
    expect(executorOf({ name: 'release', kind: 'release' }, facts({ deploy: { ...deploy, configured: false } }))).toEqual({ line: 'GitHub Actions · no deploy check configured', action: { label: 'Configure deploy checks', href: '/settings/products/1' }, cannotRun: true })
  })
  it('a human gate without a role is "You"', () => {
    expect(executorOf({ name: 'approve', kind: 'agent', gate: 'human' }, facts())).toEqual({ line: 'You', action: null, cannotRun: false })
  })
  it('a custom stage with no role and no gate has no one assigned and links to the workflow editor', () => {
    expect(executorOf({ name: 'legal', kind: 'agent' }, facts())).toEqual({ line: 'No one assigned', action: { label: 'Edit workflow', href: '/workflow/edit' }, cannotRun: true })
  })
  it('done and container stages run nothing', () => {
    expect(executorOf({ name: 'done', kind: 'done' }, facts())).toBeNull()
    expect(executorOf({ name: 'parent', kind: 'container' }, facts())).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { DEPLOY_WAIT, executorOf, waitingWho, type ExecutorFacts } from '../src/lib/executors'

const now = Date.parse('2026-11-13T12:00:00Z')
const deploy = { configured: true, lastAt: '2026-11-13T11:43:00Z', ci: 'GitHub Actions', href: '/settings/products/1' }
const facts = (f: Partial<ExecutorFacts> = {}): ExecutorFacts => ({ waiting: 0, deploy, now, ...f })
const role = (r: Partial<NonNullable<ExecutorFacts['role']>> = {}) => ({ id: 'engineer', title: 'Software engineer', working: 0, idle: 0, connected: 0, ...r })

describe('executorOf', () => {
  it('a stage with a role and connected sessions says who works and who is idle', () => {
    expect(executorOf({ name: 'build', kind: 'build', role: 'engineer' }, facts({ role: role({ working: 2, idle: 1, connected: 3 }) }))).toEqual({ line: 'Software engineer · 2 working · 1 idle', action: null, cannotRun: false })
  })
  it('a stage with a role and no session names the waiting Runs and offers to connect one', () => {
    expect(executorOf({ name: 'build', kind: 'build', role: 'engineer' }, facts({ role: role(), waiting: 3 }))).toEqual({ line: 'Software engineer · none connected, 3 Runs waiting', action: { label: 'Connect a Software engineer', href: '/team?role=engineer' }, cannotRun: true, waits: 'Waiting for a Software engineer session' })
    expect(executorOf({ name: 'build', kind: 'build', role: 'engineer' }, facts({ role: role(), waiting: 1 }))?.line).toBe('Software engineer · none connected, 1 Run waiting')
  })
  it('the release stage runs on the Product CI: last deploy when configured, a configure action when not', () => {
    expect(executorOf({ name: 'release', kind: 'release' }, facts())).toEqual({ line: 'GitHub Actions · last deploy 17 min ago', action: null, cannotRun: false })
    expect(executorOf({ name: 'release', kind: 'release' }, facts({ deploy: { ...deploy, lastAt: null } }))?.line).toBe('GitHub Actions · no deploy reported yet')
    expect(executorOf({ name: 'release', kind: 'release' }, facts({ deploy: { ...deploy, configured: false } }))).toEqual({ line: 'GitHub Actions · no deploy check configured', action: { label: 'Configure deploy checks', href: '/settings/products/1' }, cannotRun: true, waits: "Waiting for the Product's deploy check" })
  })
  it('a release stage with a Product owner gate still shows the Product CI', () => {
    expect(executorOf({ name: 'release', kind: 'release', gate: 'human' }, facts())?.line).toBe('GitHub Actions · last deploy 17 min ago')
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

describe('waitingWho', () => {
  const open = (releaseState: string | null = null) => ({ open: true, track: { releaseState } })
  const queued = { phase: 'queued', who: null }
  const noSession = executorOf({ name: 'build', kind: 'build', role: 'engineer' }, facts({ role: role(), waiting: 1 }))!
  const noCheck = executorOf({ name: 'release', kind: 'release' }, facts({ deploy: { ...deploy, configured: false } }))!
  const healthy = executorOf({ name: 'build', kind: 'build', role: 'engineer' }, facts({ role: role({ idle: 1, connected: 1 }) }))!
  it('a Ticket in a stage without a session names the missing role', () => expect(waitingWho('build', noSession, open(), queued)).toBe('Waiting for a Software engineer session'))
  it('a release stage without a deploy check names the deploy check', () => expect(waitingWho('release', noCheck, open(), queued)).toBe(DEPLOY_WAIT))
  it('a Staging Ticket without a CI report past the timeout names the deploy check, even with checks configured', () => {
    const configured = executorOf({ name: 'release', kind: 'release' }, facts())!
    expect(waitingWho('release', configured, open('timed_out'), { phase: 'human', who: '@owner' })).toBe(DEPLOY_WAIT)
  })
  it('a Ticket waiting for the owner at a gate keeps the owner as Who, even when the stage has no session', () => {
    const noSession = executorOf({ name: 'plan', kind: 'plan', role: 'orchestrator' }, facts({ role: { ...role(), id: 'orchestrator', title: 'Orchestrator' } }))!
    expect(waitingWho('plan', noSession, open(), { phase: 'human', who: '@owner' })).toBe('@owner')
  })
  it('a vowel-initial role title takes "an"', () => {
    const e = executorOf({ name: 'plan', kind: 'plan', role: 'orchestrator' }, facts({ role: { ...role(), id: 'orchestrator', title: 'Orchestrator' } }))!
    expect(e.waits).toBe('Waiting for an Orchestrator session')
    expect(e.action?.label).toBe('Connect an Orchestrator')
  })
  it('a healthy stage, a working or closed Ticket keep the status who', () => {
    expect(waitingWho('build', healthy, open(), { phase: 'queued', who: null })).toBeNull()
    expect(waitingWho('build', noSession, open(), { phase: 'working', who: 'eng-1' })).toBe('eng-1')
    expect(waitingWho('build', noSession, { open: false, track: {} }, { phase: 'done', who: null })).toBeNull()
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/app/(app)/lib/actions', () => ({ sendBackAction: async () => ({}) }))

import { SendBackDialog } from '../src/app/(app)/components/SendBackDialog'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sendBackTargets, BACKLOG } from '../src/lib/actions'
import { SEND_BACK, sendBackOptions, type SendBackTarget } from '../src/lib/send-back-options'
import { compile, kindOf, parseFactory, title } from '../src/lib/workflow'
import { buildSteps, sentBackText } from '../src/app/(app)/lib/steps'

const wf = compile(parseFactory(readFileSync(fileURLToPath(new URL('../../../pack/factory.yaml', import.meta.url)), 'utf8')) as any)
const targetsOf = (stage: string): SendBackTarget[] => sendBackTargets(wf, stage).map((to) => (to === BACKLOG ? { to, title: 'Backlog' } : { to, title: title(wf, to), kind: kindOf(wf, to) }))

describe('sendBackOptions', () => {
  it('lists only the outcomes of the existing actions', () => {
    expect(sendBackOptions('Needs you')).toEqual([SEND_BACK.backToBuild])
    expect(sendBackOptions('Cancelled')).toEqual([SEND_BACK.backToBacklog])
    expect(sendBackOptions('Accept on staging', 'release')).toEqual([SEND_BACK.requestChanges])
  })
  it('lists nothing for any other need', () => {
    expect(sendBackOptions('Approve plan', 'plan')).toEqual([])
    expect(sendBackOptions(null)).toEqual([])
  })
  it('asks for a note only where the staging action needs one', () => {
    expect(Object.values(SEND_BACK).filter((o) => o.noteRequired).map((o) => o.value)).toEqual(['requestChanges'])
  })
})

describe('sendBackOptions for a Bauherr', () => {
  it('lists every backward target of the stage with a consequence, on any Ticket', () => {
    for (const stage of ['plan', 'build', 'review', 'release']) {
      const targets = targetsOf(stage)
      const options = sendBackOptions(null, null, targets)
      expect(options.map((o) => o.value)).toEqual(targets.map((t) => `to:${t.to}`))
      expect(options.every((o) => o.consequence && o.label.includes(': '))).toBe(true)
    }
    expect(sendBackOptions(null, null, targetsOf('review')).map((o) => o.label)).toContain('Backlog: plan it again from the start')
    expect(sendBackOptions(null, null, targetsOf('build')).map((o) => o.label)).toContain('Plan: plan again')
  })
  it('drops the generic target a need option already leads to', () => {
    const review = sendBackOptions('Needs you', null, targetsOf('review'))
    expect(review[0]).toEqual(SEND_BACK.backToBuild)
    expect(review.filter((o) => o.value === 'to:build')).toEqual([])
    expect(review.map((o) => o.value)).toEqual(['backToBuild', 'to:triage', 'to:backlog'])
    expect(sendBackOptions('Cancelled', null, targetsOf('build')).map((o) => o.value)).not.toContain('to:backlog')
    const staging = sendBackOptions('Accept on staging', 'release', targetsOf('release')).map((o) => o.value)
    expect(staging[0]).toBe('requestChanges')
    expect(staging).not.toContain('to:build')
  })
  it('keeps what a Product owner has today (no targets)', () => {
    expect(sendBackOptions('Accept on staging', 'release', [])).toEqual([SEND_BACK.requestChanges])
    expect(sendBackOptions(null, null, [])).toEqual([])
  })
})

describe('sent back text', () => {
  const span = { id: 1, at: '2026-01-01T10:00:00Z', until: '2026-01-01T11:00:00Z', seconds: 3600, stage: 'plan', stageKind: 'plan', phase: 'queued' as const, fromStage: 'build|working', outcome: null, run: null, executor: 'human', actor: 'o@x.dev', cause: 'sendBack', note: 'Scope was wrong', backfilled: false, workflowVersion: null }
  it('names the stage, the person and the why', () => {
    expect(sentBackText(wf, span)).toBe('Sent back to Plan by o@x.dev: Scope was wrong')
    expect(sentBackText(wf, { ...span, note: null })).toBe('Sent back to Plan by o@x.dev.')
    expect(sentBackText(wf, { ...span, cause: 'gate:approve' })).toBeNull()
  })
  it('shows on the step the send back started', () => {
    const steps = buildSteps(wf, [span], [], [], { current: 'plan', provider: null, admin: false })
    expect(steps.visits[0]!.steps[0]!.sentBack).toBe('Sent back to Plan by o@x.dev: Scope was wrong')
  })
})

describe('SendBackDialog', () => {
  it('renders one trigger and no native dialog', () => {
    const html = renderToStaticMarkup(createElement(SendBackDialog, { ticket: 7, options: [SEND_BACK.backToBuild] }))
    expect(html).toContain('Send back…')
    expect(html).not.toContain('confirm(')
  })
})

import { describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { fold, next } from '../../src/core/lifecycle'
import type { Finding, TicketRecord } from '../../src/core/record/schema'
import { briefed, CONFIG, ev, inBuild, merged } from './fixtures'

const fixed: Finding = {
  id: 'f1',
  axis: 'spec',
  text: 'The list drops the last row',
  evidence: { kind: 'repro', pointer: 'open the list' },
  status: 'fixed',
}

const accepted = [...merged, ev('result.accepted')]
const stepFor = (events: AppEvent[], record: TicketRecord = briefed()) => next(record, fold(events), CONFIG)

describe('an accepted ticket', () => {
  it('is done at once, with no further run, when a finding was fixed', () => {
    expect(stepFor(accepted, briefed({ findings: [fixed] }))).toEqual({ kind: 'done' })
  })

  it('is done at once when the owner sent the Result back first', () => {
    const sentBack = [...merged, ev('result.sent-back'), ...merged.slice(-3), ev('result.accepted')]
    expect(stepFor(sentBack)).toEqual({ kind: 'done' })
  })

  it('is done at once when the owner asked for Brief changes first', () => {
    const changes = [...inBuild.slice(0, 3), ev('brief.changes-requested'), ...inBuild.slice(3)]
    expect(stepFor([...changes, ...merged.slice(inBuild.length), ev('result.accepted')])).toEqual({ kind: 'done' })
  })
})

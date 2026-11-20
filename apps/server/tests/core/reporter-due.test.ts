import { describe, expect, it } from 'vitest'
import { fold } from '../../src/core/lifecycle'
import { reporterDue } from '../../src/core/intake/timing'
import { ev } from './fixtures'

const ASKED = '2026-11-01T10:00:00Z'
const timing = { remindDays: 7, silentDays: 21 }
const after = (days: number, extra = 0) => new Date(Date.parse(ASKED) + days * 86_400_000 + extra)
const waiting = fold([ev('intake.asked', { round: 1 })])
const reminded = fold([ev('intake.asked', { round: 1 }), ev('reporter.reminded')])

describe('reporterDue', () => {
  it('is quiet before the reminder day', () => {
    expect(reporterDue(waiting, ASKED, after(7, -1), timing)).toBeNull()
  })

  it('reminds at 7 days, once per round', () => {
    expect(reporterDue(waiting, ASKED, after(7), timing)).toBe('remind')
    expect(reporterDue(reminded, ASKED, after(10), timing)).toBeNull()
  })

  it('is silent at 21 days, with or without a reminder', () => {
    expect(reporterDue(waiting, ASKED, after(21), timing)).toBe('silent')
    expect(reporterDue(reminded, ASKED, after(21), timing)).toBe('silent')
    expect(reporterDue(waiting, ASKED, after(21, -1), timing)).toBe('remind')
  })

  it('follows the Product settings', () => {
    expect(reporterDue(waiting, ASKED, after(3), { remindDays: 2, silentDays: 4 })).toBe('remind')
    expect(reporterDue(waiting, ASKED, after(4), { remindDays: 2, silentDays: 4 })).toBe('silent')
  })

  it('does nothing when the ticket does not wait on the reporter', () => {
    const replied = fold([ev('intake.asked', { round: 1 }), ev('reporter.replied')])
    expect(reporterDue(replied, ASKED, after(30), timing)).toBeNull()
    expect(reporterDue(fold([]), null, after(30), timing)).toBeNull()
  })
})

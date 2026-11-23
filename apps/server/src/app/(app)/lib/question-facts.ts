import type { TicketView } from '../../../core/views/ticket'

const times = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

const failedRuns = (view: TicketView): string[] => {
  const failed = view.runs.filter((run) => run.status === 'failed')
  const error = failed.at(-1)?.error
  return [`${times(failed.length, 'run')} failed.`, ...(error ? [`Last error: ${error}`] : [])]
}

const reporterSilent = (view: TicketView): string[] => {
  const asked = view.events.filter((event) => event.type === 'intake.asked').length
  return [`The reporter was asked in ${times(asked, 'round')} and did not reply.`]
}

const disputed = (view: TicketView): string[] =>
  view.facts && view.facts.missing.length > 0 ? [`Missing from the issue: ${view.facts.missing.join(', ')}.`] : []

const deployStalled = (view: TicketView): string[] => {
  if (!view.deploy) return []
  const names = view.deploy.checks.join(', ')
  return view.deploy.reason === 'failed'
    ? [`These deploy checks failed: ${names}.`]
    : [`No result arrived in the time you set for: ${names}.`]
}

export const recommendedOption = (view: TicketView, reason: string): string | null =>
  reason === 'deploy-stalled' && view.deploy?.reason === 'failed' ? 'check-again' : null

const production = (view: TicketView): string[] =>
  view.pullRequest ? [`Pull request #${view.pullRequest.number} is merged.`] : []

const FACTS: Record<string, (view: TicketView) => string[]> = {
  'failed-runs': failedRuns,
  'reporter-silent': reporterSilent,
  disputed,
  'deploy-stalled': deployStalled,
  production,
  'production-held': production,
}

export const questionFacts = (view: TicketView, reason: string): string[] => FACTS[reason]?.(view) ?? []

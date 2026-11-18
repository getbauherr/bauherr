import { stageTitle } from './workflow-labels'
import { asList, SET_NAME, SUGGESTED_SETS } from './workflow-when'
import type { Workflow } from './workflow-rules'

export type PathSets = Record<string, string[]>

export const formatPathSets = (sets: PathSets | null | undefined): string => Object.entries(sets ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, globs]) => `${name}:${globs.length ? ' ' + globs.join(', ') : ''}`).join('\n')

export const parsePathSets = (text: string): PathSets => {
  const out: PathSets = {}
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf(':')
    const name = (i < 0 ? line : line.slice(0, i)).trim()
    if (!SET_NAME.test(name)) throw new Error(`"${name}" is not a set name: use lowercase letters, digits and dashes, then a colon and the paths.`)
    if (name in out) throw new Error(`The set ${name} is listed twice.`)
    const globs = i < 0 ? [] : line.slice(i + 1).split(',').map((g) => g.trim()).filter(Boolean)
    if (globs.some((g) => /\s/.test(g))) throw new Error(`Paths of ${name} must be separated by commas and contain no spaces.`)
    out[name] = globs
  }
  return out
}

export const missingSuggestions = (sets: PathSets): string[] => SUGGESTED_SETS.filter((n) => !(n in sets))

export const neverRuns = (wf: Pick<Workflow, 'stages'>, sets: PathSets): { stage: string; title: string; names: string[] }[] =>
  wf.stages.flatMap((s) => {
    const never = (when: typeof s.when) => {
      const names = asList(when?.touches)
      return names.length && !names.some((n) => sets[n]?.length) ? names : null
    }
    const own = never(s.when)
    const jobs = (s.jobs ?? []).flatMap((j) => {
      const names = never(j.when)
      return names ? [{ stage: `${s.name}.${j.id}`, title: `${stageTitle(s)}: ${j.id} Job`, names }] : []
    })
    return own ? [{ stage: s.name, title: stageTitle(s), names: own }, ...jobs] : jobs
  })

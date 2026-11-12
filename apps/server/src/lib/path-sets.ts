import { stageTitle } from './workflow-labels'
import { asList, SET_NAME, SUGGESTED_SETS } from './workflow-when'
import type { Workflow } from './workflow-rules'

// Browser-safe. The Product's named path sets as the textarea shows them: one set per line, `name: glob, glob`.

export type PathSets = Record<string, string[]>

/** The text of the "Path sets" field, sets by name (the database does not keep the order of keys). */
export const formatPathSets = (sets: PathSets | null | undefined): string => Object.entries(sets ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, globs]) => `${name}:${globs.length ? ' ' + globs.join(', ') : ''}`).join('\n')

/** Reads the field; throws an Error with the message to show. */
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

/** The suggested names a Product has not declared yet. */
export const missingSuggestions = (sets: PathSets): string[] => SUGGESTED_SETS.filter((n) => !(n in sets))

/** Steps of the workflow that never run for a Product with these sets: every set they name is missing or empty. `names` are the sets to declare. */
export const neverRuns = (wf: Pick<Workflow, 'stages'>, sets: PathSets): { stage: string; title: string; names: string[] }[] =>
  wf.stages.flatMap((s) => {
    const names = asList(s.when?.touches)
    return names.length && !names.some((n) => sets[n]?.length) ? [{ stage: s.name, title: stageTitle(s), names }] : []
  })

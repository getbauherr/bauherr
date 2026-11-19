const SET_NAME = /^[a-z][a-z0-9-]*$/

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

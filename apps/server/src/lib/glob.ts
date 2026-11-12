// Browser-safe path globs: `*` within a segment, `**` across segments, `?` one character.
export const WILD = /[*?]/
export const matches = (glob: string, path: string): boolean =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' })[m]!)}$`).test(path)

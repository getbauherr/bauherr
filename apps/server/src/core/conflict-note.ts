export const conflictNote = (base: string): string =>
  `The pull request conflicts with ${base}. Rebase onto it, resolve the conflicts, run the checks and ` +
  'submit again. Do not change anything else.'

const FENCE_CHAR = '`'

export const inertBlock = (text: string): string => {
  const runs = text.match(/`+/g) ?? []
  const width = Math.max(3, ...runs.map((run) => run.length + 1))
  const fence = FENCE_CHAR.repeat(width)
  return `${fence}text\n${text.replace(/\r\n?/g, '\n')}\n${fence}`
}

export const inertName = (name: string): string => name
    .replace(/[^\p{L}\p{N} ._,:@-]/gu, '_')
    .replace(/@/g, ' at ')
    .slice(0, 100)

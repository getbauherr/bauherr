export type DiffKind = 'context' | 'added' | 'removed'
export type DiffLine = { kind: DiffKind; text: string }
export type Diff = { lines: DiffLine[]; additions: number; deletions: number }

const CONTEXT = 1

const rows = (body: string): string[] => (body === '' ? [] : body.replace(/\n$/, '').split('\n'))

const lengths = (before: string[], after: string[]): number[][] => {
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  return table
}

const walk = (before: string[], after: string[]): DiffLine[] => {
  const table = lengths(before, after)
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    const same = i < before.length && j < after.length && before[i] === after[j]
    const dropsBefore = j === after.length || (i < before.length && table[i + 1][j] >= table[i][j + 1])
    if (same) {
      lines.push({ kind: 'context', text: before[i] })
      i++
      j++
    } else if (i < before.length && dropsBefore) {
      lines.push({ kind: 'removed', text: before[i] })
      i++
    } else {
      lines.push({ kind: 'added', text: after[j] })
      j++
    }
  }
  return lines
}

export const diffOf = (before: string, after: string): Diff => {
  const lines = walk(rows(before), rows(after))
  const near = lines.map((_, index) =>
    lines.slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1).some((other) => other.kind !== 'context'),
  )
  return {
    lines: lines.filter((_, index) => near[index]),
    additions: lines.filter((line) => line.kind === 'added').length,
    deletions: lines.filter((line) => line.kind === 'removed').length,
  }
}

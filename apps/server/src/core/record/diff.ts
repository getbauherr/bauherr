export type DiffMark = '+' | '-' | ' '
export type DiffLine = { mark: DiffMark; text: string }
export type DriftLine = DiffLine & { inPlan: boolean }

export const diffLines = (source: string): DiffLine[] =>
  source
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const first = line[0]
      return first === '+' || first === '-' ? { mark: first, text: line.slice(1) } : { mark: ' ', text: line }
    })

const keyOf = (line: DiffLine): string => `${line.mark}${line.text.trim()}`

export const driftOf = (shape: string, outline: string): DriftLine[] => {
  const planned = new Set(diffLines(shape).map(keyOf))
  return diffLines(outline).map((line) => ({ ...line, inPlan: line.mark === ' ' || planned.has(keyOf(line)) }))
}

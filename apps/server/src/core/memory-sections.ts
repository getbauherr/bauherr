import { STAGE_LABEL, type MemoryStage } from './memory'

export const SECTIONS = ['All stages', 'Brief', 'Build', 'Review', 'Verify'] as const

export type Section = (typeof SECTIONS)[number]

const isSection = (heading: string): heading is Section => SECTIONS.some((section) => section === heading)

export const sectionsOf = (body: string): Record<string, string> => {
  const lines: Record<string, string[]> = {}
  let current: Section | null = null
  for (const line of body.split('\n')) {
    const heading = /^## (.+?)\s*$/.exec(line)?.[1]
    if (heading !== undefined) {
      current = isSection(heading) ? heading : null
      if (current) lines[current] ??= []
    } else if (current) {
      lines[current]?.push(line)
    }
  }
  return Object.fromEntries(Object.entries(lines).map(([section, text]) => [section, text.join('\n').trim()]))
}

export const partsFor = (body: string, stage: MemoryStage): string => {
  const sections = sectionsOf(body)
  return [sections['All stages'], sections[STAGE_LABEL[stage]]].filter((text) => text).join('\n\n')
}

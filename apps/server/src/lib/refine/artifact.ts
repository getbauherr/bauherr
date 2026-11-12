import { lineDiff, type DiffLine, type Point } from './model'

const MARKER = /<!--\s*bauherr:[^>]*-->\n?/g

/** One section of the refined Ticket. A placeholder (`point` set) stands for an open point the text has no section for yet. */
export type Section = { key: string; heading: string; text: string; changed: boolean; point?: { id: string; now: boolean } }
export type Hunk = { id: string; range: string; lines: DiffLine[] }
/** What the artifact panel shows: the Ticket as it will be sent, which sections the conversation changed, and the diff of those. */
export type Artifact = { title: string; titleChanged: boolean; sections: Section[]; hunks: Hunk[]; changes: number; version: { n: number; at: string | null } }

type Part = { key: string; heading: string; text: string }

/** The `#`/`##`/`###` sections of a Ticket text (bauherr markers hidden); text before the first heading is "Summary". Repeated headings get a counter in their key. */
export const sectionsOf = (body: string): Part[] => {
  const parts: { heading: string; lines: string[] }[] = [{ heading: 'Summary', lines: [] }]
  for (const l of body.replace(/\r\n/g, '\n').replace(MARKER, '').split('\n')) {
    const h = /^#{1,3}\s+(.+?)\s*$/.exec(l)
    if (h) parts.push({ heading: h[1]!, lines: [] })
    else parts.at(-1)!.lines.push(l)
  }
  const seen = new Map<string, number>()
  return parts
    .map((p) => ({ heading: p.heading, text: p.lines.join('\n').trim() }))
    .filter((p, i) => i > 0 || p.text)
    .map((p) => {
      const base = p.heading.toLowerCase()
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return { key: n > 1 ? `${base}#${n}` : base, ...p }
    })
}

/**
 * The artifact of a conversation: the sections of `pending` (the Ticket text plus the conversation's edits), those that differ from `current` marked as changed, one diff hunk
 * per changed or removed section, and a placeholder for every open point before the acceptance criteria (the first of them is the one being asked now).
 */
export const buildArtifact = (a: { title: string; currentTitle: string; current: string; pending: string; points: Point[]; version: { n: number; at: string | null } }): Artifact => {
  const [cur, pen] = [sectionsOf(a.current), sectionsOf(a.pending)]
  const was = new Map(cur.map((s) => [s.key, s.text]))
  const has = new Set(pen.map((s) => s.key))
  const sections: Section[] = pen.map((s) => ({ ...s, changed: was.get(s.key) !== s.text }))
  const hunks: Hunk[] = [
    ...sections.filter((s) => s.changed).map((s) => ({ id: s.key, range: s.heading, lines: lineDiff(was.get(s.key) ?? '', s.text) })),
    ...cur.filter((s) => !has.has(s.key)).map((s) => ({ id: s.key, range: `${s.heading} (removed)`, lines: lineDiff(s.text, '') })),
  ]
  const open = a.points.filter((p) => p.status === 'open')
  const waiting = open.map((p, i): Section => ({ key: `point-${p.id}`, heading: p.title, text: i === 0 ? `Waiting for your answer: ${p.title}` : `Open: ${p.title}`, changed: false, point: { id: p.id, now: i === 0 } }))
  const at = sections.findIndex((s) => /acceptance|done when|criteria/i.test(s.heading))
  sections.splice(at < 0 ? sections.length : at, 0, ...waiting)
  const titleChanged = a.title !== a.currentTitle
  return { title: a.title, titleChanged, sections, hunks, changes: hunks.length + (titleChanged ? 1 : 0), version: a.version }
}

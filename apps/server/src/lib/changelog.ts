const PINNED = 'Changed behaviour'
const INTERNAL = /^Internal: (\d+ changes?) \((.*)\)$/m

export interface VersionView {
  heading: string
  md: string
  internal: { summary: string; links: string } | null
}

export const changelogView = (md: string, area?: string): { areas: string[]; versions: VersionView[] } => {
  const parts = md.split(/^(?=## )/m).slice(1).map((v) => {
    const [heading = '', ...rest] = v.split('\n')
    return { heading, body: rest.join('\n').trim() }
  })
  const areas = [...new Set(parts.flatMap((v) => [...v.body.matchAll(/^### (.+)$/gm)].map((m) => m[1]!)))].filter((h) => h !== PINNED)
  const versions = parts.flatMap(({ heading, body }) => {
    const found = INTERNAL.exec(body)
    const text = body.replace(INTERNAL, '').trim()
    const shown = area ? text.split(/^(?=### )/m).filter((s) => s.startsWith(`### ${area}\n`) || s.startsWith(`### ${PINNED}\n`)).join('\n').trim() : text
    const internal = !area && found ? { summary: `Internal: ${found[1]}`, links: found[2]!.split(', ').map((l) => `- ${l}`).join('\n') } : null
    return shown || internal ? [{ heading, md: `${heading}\n\n${shown}`.trim(), internal }] : []
  })
  return { areas, versions }
}

export const stripBullets = (md: string): string =>
  md.replace(/^ {2,}[-*] .*\n?/gm, '').replace(/, \[#\d+ [^\]]*\]\([^)]*\/pull\/\d+\)/g, '').replace(/\n{3,}/g, '\n\n')

export const replaceVersion = (md: string, version: string, notes: string): string =>
  md.split(/^(?=## )/m).map((part) => {
    const [heading = '', ...rest] = part.split('\n')
    if (heading.split(' ')[1] !== version.replace(/^v/, '')) return part
    const lead = rest.join('\n').split(/^### |^Internal: /m)[0]!.trim()
    return `${heading}\n\n${lead ? `${lead}\n\n` : ''}${notes}\n\n`
  }).join('')

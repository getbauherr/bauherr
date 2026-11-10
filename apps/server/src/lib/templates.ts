import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Payload } from 'payload'
import { type Section, type TemplateName, TEMPLATE_NAMES, forAgent, parseSections } from './template-text'

export * from './template-text'

/** Skills whose text carries these templates for the agent (`load_skill`, and the Runner's materialised skills). */
export const SKILL_TEMPLATES: Record<string, TemplateName[]> = { 'run-contract': ['plan', 'worklog'], review: ['review'], triage: ['triage-questions'], intake: ['request'] }

export type Tpl = { name: TemplateName; title: string; usedBy: string; description: string; body: string; source: 'pack' | 'workspace'; sections: string[]; parsed: Section[]; layout: 'tight' | 'normal'; /** Heading of every id in the pack's own template, for a section the Workspace's template dropped. */ fallback: Record<string, { heading: string; level: number }> }

const defaultDir = () => resolve(process.cwd(), '../../pack')
const packFile = (name: string): string => {
  for (const dir of [process.env.BAUHERR_PACK_DIR, defaultDir()]) {
    const f = dir && resolve(dir, 'templates', `${name}.md`)
    if (f && existsSync(f)) return readFileSync(f, 'utf8')
  }
  throw new Error(`no pack template ${name}`)
}

/** Front matter (`key: value` lines) and the body after it. */
const split = (md: string): { meta: Record<string, string>; body: string } => {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md)
  if (!m) return { meta: {}, body: md }
  return { meta: Object.fromEntries(m[1]!.split('\n').map((l) => /^([\w-]+):\s*(.*)$/.exec(l)).filter((x): x is RegExpExecArray => !!x).map((x) => [x[1]!, x[2]!])), body: md.slice(m[0].length) }
}

const build = (name: TemplateName, body: string, source: Tpl['source']): Tpl => {
  const { meta, body: pack } = split(packFile(name))
  const parsed = parseSections(body)
  return {
    name, title: meta.title ?? name, usedBy: meta.used_by ?? '', description: meta.description ?? '', body, source,
    sections: parsed.map((s) => s.heading), parsed, layout: meta.layout === 'tight' ? 'tight' : 'normal',
    fallback: Object.fromEntries(parseSections(pack).map((s) => [s.id, { heading: s.heading, level: s.level }])),
  }
}

/** The pack's own template (no Workspace override). */
export const packTemplate = (name: TemplateName): Tpl => build(name, split(packFile(name)).body, 'pack')

/** The Workspace's template, else the pack's. */
export const template = async (payload: Payload, workspace: number | string, name: TemplateName): Promise<Tpl> => {
  const row = (await payload.find({ collection: 'templates', where: { workspace: { equals: workspace }, name: { equals: name } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as { body?: string } | undefined
  return row?.body ? build(name, row.body, 'workspace') : packTemplate(name)
}

/** Names of the pack's templates that exist as files. */
export const packNames = (): string[] => {
  const dir = [process.env.BAUHERR_PACK_DIR, defaultDir()].map((d) => d && resolve(d, 'templates')).find((d) => d && existsSync(d))
  return dir ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : []
}

/** The Workspace's staging-summary and release-note templates, which `collectItem` and `renderNotes` read together. */
export const noteTemplates = async (payload: Payload, workspace: number | string): Promise<{ summary: Tpl; note: Tpl }> => ({ summary: await template(payload, workspace, 'staging-summary'), note: await template(payload, workspace, 'release-note') })

/** A template as the end of a skill's text: the Workspace's structure with its guidance. */
export const templateBlock = (t: Pick<Tpl, 'title' | 'body'>): string => `## Template: ${t.title}\n\n\`\`\`\`markdown\n${forAgent(t.body).trim()}\n\`\`\`\``

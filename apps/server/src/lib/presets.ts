import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { inlineProfiles } from './factory'
import { profileOf, type TeamRole } from './sessions'
import { compile, corePack, gates, packDir, type Workflow } from './workflow'

export const PRESETS = ['solo', 'standard', 'careful'] as const
export type PresetId = (typeof PRESETS)[number]
export const isPreset = (v: unknown): v is PresetId => PRESETS.includes(v as PresetId)

/** Card text of each setup preset; roles and approvals on the card come from the compiled file, so they cannot drift from it. */
export const PRESET_TEXT: Record<PresetId, { title: string; blurb: string }> = {
  solo: { title: 'Solo', blurb: 'One engineer does everything. Plans pass without your approval.' },
  standard: { title: 'Standard', blurb: 'An orchestrator triages, an engineer builds, a reviewer checks. You approve plans. A security review runs when a change touches the security paths of the Product.' },
  careful: { title: 'Careful', blurb: 'Standard, plus specialist reviews when a change needs them (security paths, user-facing paths, bug fixes) before the code review, and your acceptance on staging.' },
}

/** `presets/<id>.yaml` of the pack dir, else of the core pack, with the role profiles inlined (read relative to the pack that holds the file). */
export const presetSource = (id: PresetId): string => {
  const path = [packDir(), corePack()].map((d) => resolve(d, 'presets', `${id}.yaml`)).find(existsSync)
  if (!path) throw new Error(`no preset ${id} in the pack`)
  const doc = parseDocument(readFileSync(path, 'utf8')).toJS() as Record<string, any>
  const findings: string[] = []
  inlineProfiles(doc, dirname(dirname(path)), findings)
  if (findings.length) throw new Error(findings.join('; '))
  return stringify(doc)
}

export const presetWorkflow = (id: PresetId): Workflow => compile(parseDocument(presetSource(id)).toJS())

/** What a preset does, in plain words: the roles that work a stage (in stage order) and where the owner is asked. */
export const presetFacts = (wf: Workflow): { roles: { id: string; title: string; avatar: string }[]; asks: string[] } => {
  const used = [...new Set(wf.stages.map((s) => s.role).filter((r): r is string => !!r))]
  const g = gates(wf)
  return {
    roles: used.map((id) => wf.roles.find((r) => r.id === id)!).map((r) => ({ id: r.id, title: r.title, avatar: r.avatar ?? r.id })),
    asks: ['Questions Triage cannot answer itself', ...(g.plan ? ['Approve each plan'] : []), ...(g.staging ? ['Accept on staging'] : []), ...(g.production ? ['Approve production'] : [])],
  }
}

/** The roster of a workflow as the Team page's role cards need it, without sessions (the setup preview of a preset). */
export const rosterOf = (wf: Workflow): TeamRole[] =>
  wf.roles.map((r) => ({
    id: r.id,
    title: r.title,
    avatar: r.avatar ?? r.id,
    skills: r.skills ?? [],
    profile: profileOf(r),
    ...(r.tier && { tier: r.tier }),
    ...(r.provider && { provider: r.provider }),
    ...(r.model && { model: r.model }),
    ...(r.agents && { agents: r.agents }),
    exceptions: !!r.exceptions,
    stages: wf.stages.filter((s) => s.role === r.id).map((s) => ({ name: s.name, title: s.title, kind: s.kind })),
    sessions: [],
    autonomous: [],
  }))

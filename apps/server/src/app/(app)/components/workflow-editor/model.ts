import { addStep, readDraft, setPath, stagesOf, type Doc } from '../../../../lib/workflow-edit'
import { SPECIAL_TARGET, stageTitle } from '../../../../lib/workflow-labels'

export type RoleView = { id: string; title: string; avatar: string; agents?: number; model: string }

export const rolesOf = (doc: Doc): RoleView[] =>
  Object.entries((doc?.team?.roles ?? {}) as Record<string, Doc>).map(([id, r]) => ({ id, title: r.title ?? id, avatar: r.avatar ?? id, agents: r.agents, model: r.tier ? `${r.tier[0].toUpperCase()}${r.tier.slice(1)} tier` : (r.model ?? '') }))

export const targetTitle = (doc: Doc, t: string): string => SPECIAL_TARGET[t] ?? stageTitle(stagesOf(doc).find((s) => s.name === t) ?? { name: t })

/** Findings that name a step (`stage "x" ...`), by step name; the rest are about the file as a whole. */
export const findingsByStage = (findings: string[]): Map<string, string[]> => {
  const m = new Map<string, string[]>()
  for (const f of findings) {
    const name = /^stage "([^"]+)"/.exec(f)?.[1]
    if (name) m.set(name, [...(m.get(name) ?? []), f])
  }
  return m
}

/** Findings the edit `after` adds on top of the ones the draft already has. */
const added = (before: string[], after: string): string[] => {
  const r = readDraft(after)
  return r.ok ? r.findings.filter((f) => !before.includes(f)) : ['not valid']
}

/** Whether a step may be spliced in after `after`: tried, then judged by the rules (no stage name is built in). */
export const canAddAfter = (yaml: string, findings: string[], after: string, role: string): boolean => {
  try {
    return added(findings, addStep(yaml, { after, kind: 'agent', title: 'Probe', role, skill: 'probe' }).yaml).length === 0
  } catch {
    return false
  }
}

/** Targets a path may take: the current one plus every step or special target the rules still accept. */
export const allowedTargets = (yaml: string, findings: string[], doc: Doc, stage: string, outcome: string): string[] => {
  const current = stagesOf(doc).find((s) => s.name === stage)?.outcomes?.[outcome] as string
  return [...stagesOf(doc).map((s) => String(s.name)), ...Object.keys(SPECIAL_TARGET)].filter((t) => {
    if (t === current) return true
    if (t === stage) return false
    try {
      return added(findings, setPath(yaml, stage, outcome, t)).length === 0
    } catch {
      return false
    }
  })
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Payload, PayloadRequest } from 'payload'
import { parse } from 'yaml'
import { workflowFor } from './factory'
import { checkpointBy, gates, order, type Workflow } from './workflow'

export type Mode = 'session' | 'autonomous'
const isMode = (v: unknown): v is Mode => v === 'session' || v === 'autonomous'

const packDir = () => process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack')

export type PackStage = { name: string; kind?: string; mode?: unknown; gate?: string; production_gate?: string; exclude_labels?: string[]; steps?: { kind: string; skill?: string }[] }
let security: { path: string; stages: PackStage[] } | undefined

export const packed = (wf: Workflow): PackStage[] => {
  const path = resolve(packDir(), 'workflow-security.yaml')
  if (security?.path !== path) {
    security = {
      path,
      stages: (() => {
        try {
          return (parse(readFileSync(path, 'utf8')) as { stages?: PackStage[] }).stages ?? []
        } catch {
          return []
        }
      })(),
    }
  }
  const core = wf.stages
    .filter((s) => s.kind !== 'container')
    .map(({ name, kind, mode, gate, production_gate, exclude_labels, skill }) => ({ name, kind, mode, gate, production_gate, exclude_labels, ...(skill && { steps: [{ kind: 'agent-run', skill }] }) }))
  return [...core, ...security.stages]
}

export type HumanGate = 'refine' | 'plan' | 'staging' | 'production'

export const gateOn = (wf: Workflow, stage: 'plan' | 'release'): boolean => (stage === 'plan' ? gates(wf).plan : gates(wf).staging && checkpointBy(wf, 'staging') === 'bauherr')

export const stagingGateOn = (wf: Workflow, product: { productOwnerTestsStaging?: boolean | null }, ownerAssigned: boolean): boolean => gateOn(wf, 'release') || (gates(wf).staging && !!product.productOwnerTestsStaging && ownerAssigned)

export const productionGateOn = (wf: Workflow, product: { productionGate?: boolean | null } = {}): boolean => gates(wf).production || !!product.productionGate

export const hasProductionChecks = (product: { productionChecks?: string | null }): boolean => !!product.productionChecks?.trim()

export const humanGates = (wf: Workflow, staging = gateOn(wf, 'release')): HumanGate[] => [
  'refine',
  ...(gateOn(wf, 'plan') ? (['plan'] as const) : []),
  ...(staging ? (['staging'] as const) : []),
  ...(productionGateOn(wf) ? (['production'] as const) : []),
]

export const workflowStages = (wf: Workflow): string[] => order(wf)

type WorkspaceModes = { defaultMode?: string | null; modeByStage?: Record<string, unknown> | null }

export const resolveMode = (wf: Workflow, ws: WorkspaceModes, stage: string): Mode =>
  stage === 'scan' || stage === 'docs' ? 'autonomous' : [ws.modeByStage?.[stage], ws.defaultMode, process.env.BAUHERR_DEFAULT_MODE, packed(wf).find((s) => s.name === stage)?.mode].find(isMode) ?? 'autonomous'

export const modeFor = async (payload: Payload, workspace: number | string, stage: string, req?: Partial<PayloadRequest>): Promise<Mode> =>
  resolveMode(workflowFor(workspace), (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true, req })) as WorkspaceModes, stage)

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

/** Non-container stages of the workflow, then those of the optional pack/workflow-security.yaml (not Board columns, read once per path; a bad security file adds nothing). */
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

/** Whether `gate: human` is set on the optional `plan` or `release` stage of the workflow. The release gate counts here only when it asks the Bauherr (always on for every Product); one that asks the Product owner is per Product, see `stagingGateOn`. */
export const gateOn = (wf: Workflow, stage: 'plan' | 'release'): boolean => (stage === 'plan' ? gates(wf).plan : gates(wf).staging && checkpointBy(wf, 'staging') === 'bauherr')

/** Acceptance on staging for one Product: on for every Product when it asks the Bauherr; when it asks the Product owner, only for a Product that has an assigned Product owner and the switch "Product owner tests on staging" on (else there is no checkpoint, as without a gate). */
export const stagingGateOn = (wf: Workflow, product: { productOwnerTestsStaging?: boolean | null }, ownerAssigned: boolean): boolean => gateOn(wf, 'release') || (gates(wf).staging && !!product.productOwnerTestsStaging && ownerAssigned)

/** Production gate: on by default (`production_gate: human` on `release`); a Product can also turn it on itself. Without `productionChecks` it is not skipped but shown as a "Configure production checks" gate. */
export const productionGateOn = (wf: Workflow, product: { productionGate?: boolean | null } = {}): boolean => gates(wf).production || !!product.productionGate

/** Whether the Product can observe a production deploy (`beginProduction` needs it). */
export const hasProductionChecks = (product: { productionChecks?: string | null }): boolean => !!product.productionChecks?.trim()

/** Human gates the workflow enables, in flow order (`staging`: the Product's `stagingGateOn`, default what the workflow asks of every Product). `refine` is always on (Triage's questions); `plan` and `staging` are optional; `production` is on unless `production_gate` is removed from `release`. */
export const humanGates = (wf: Workflow, staging = gateOn(wf, 'release')): HumanGate[] => [
  'refine',
  ...(gateOn(wf, 'plan') ? (['plan'] as const) : []),
  ...(staging ? (['staging'] as const) : []),
  ...(productionGateOn(wf) ? (['production'] as const) : []),
]

/** Stage names of pack/factory.yaml, in order. */
export const workflowStages = (wf: Workflow): string[] => order(wf)

type WorkspaceModes = { defaultMode?: string | null; modeByStage?: Record<string, unknown> | null }

/** `modeFor` for an already loaded Workspace. A `scan` or `docs` Run is always autonomous: only the Runner gives it read-only tools, the fence and the findings path. */
export const resolveMode = (wf: Workflow, ws: WorkspaceModes, stage: string): Mode =>
  stage === 'scan' || stage === 'docs' ? 'autonomous' : [ws.modeByStage?.[stage], ws.defaultMode, process.env.BAUHERR_DEFAULT_MODE, packed(wf).find((s) => s.name === stage)?.mode].find(isMode) ?? 'autonomous'

/**
 * Mode a Run of `stage` starts in. Precedence: Workspace.modeByStage[stage], Workspace.defaultMode,
 * env BAUHERR_DEFAULT_MODE, `mode` of the stage in pack/factory.yaml, else autonomous.
 */
export const modeFor = async (payload: Payload, workspace: number | string, stage: string, req?: Partial<PayloadRequest>): Promise<Mode> =>
  resolveMode(workflowFor(workspace), (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true, req })) as WorkspaceModes, stage)

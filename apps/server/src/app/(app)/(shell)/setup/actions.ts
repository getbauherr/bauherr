'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { upsertTicket, lastRankAfter, ticketsOf } from '../../../../lib/actions'
import { activeVersion, applyFactory, workflowFor } from '../../../../lib/factory'
import { record } from '../../../../lib/history'
import { personOf } from '../../../../lib/person'
import { isPreset, presetSource, PRESET_TEXT } from '../../../../lib/presets'
import { stageOf } from '../../../../lib/stage-move'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { loadSetup, SKIP_SESSION } from '../../lib/setup'
import { only, run, type FormState } from '../../lib/settings'

type Form = (prev: FormState, fd: FormData) => Promise<FormState>

const revalidateSetup = () => ['/setup', '/team', '/'].forEach((p) => revalidatePath(p))

/** An Admin's write on the selected Workspace; `/setup` and the pages that show the result are revalidated on success. */
const act = (fn: (c: { user: Awaited<ReturnType<typeof currentWorkspace>>['user']; workspace: number; payload: Awaited<ReturnType<typeof payloadClient>> }, fd: FormData) => Promise<void>): Form =>
  async (_prev, fd) => {
    const { user, workspace } = await currentWorkspace()
    const result = await run(async () => {
      only(user)
      if (!workspace) throw new Error('No Workspace selected.')
      await fn({ user, workspace: workspace.id, payload: await payloadClient() }, fd)
    })
    if (result.saved) revalidateSetup()
    return result
  }

/** "Use this team" and "Skip" (Standard): applies the preset's factory file as a UI apply, so a Workspace without an applied version has one afterwards. */
export const applyPreset = act(async ({ user, workspace, payload }, fd) => {
  const id = String(fd.get('preset'))
  if (!isPreset(id)) throw new Error('Choose a team.')
  const r = await applyFactory(payload, workspace, presetSource(id), { by: personOf(user), via: 'ui', note: `Setup: ${PRESET_TEXT[id].title} team`, baseVersion: (await activeVersion(payload, workspace))?.version ?? null })
  if (!r.ok) throw new Error(r.findings.join('\n'))
  revalidatePath('/settings', 'layout')
})

/** "Skip": the session step counts as seen; the audit trail row is the record. */
export const skipSession = act(async ({ user, workspace, payload }) => {
  await payload.create({ collection: 'human_touches', data: { kind: SKIP_SESSION, workspace, actor: personOf(user), at: new Date().toISOString() }, overrideAccess: true })
})

/** An open issue of the Product's ticket source becomes a Ticket in Triage right away (what the next poll would do for it); then the wizard shows its finish screen. The Product is the Workspace's setup Product, never a form value. */
export const importIssue = act(async ({ workspace, payload }, fd) => {
  const number = String(fd.get('manual') || fd.get('number') || '').replace(/^#/, '').trim()
  if (!/^\d+$/.test(number)) throw new Error('Enter the issue number, for example 12.')
  const { product } = await loadSetup(workspace)
  if (!product) throw new Error('Pick a product first.')
  const issue = await (await ticketsOf(payload, product.id)).get(number).catch(() => null)
  if (!issue) throw new Error(`Issue #${number} was not found in this repository.`)
  if (issue.state !== 'open') throw new Error(`Issue #${number} is closed.`)
  const ticket = await upsertTicket(
    payload,
    { workspace, product: product.id, externalId: issue.id, number: issue.number, url: issue.url, title: issue.title, state: issue.state, labels: issue.labels, assignee: issue.assignee, assignees: issue.assignees.join(','), sourceUpdatedAt: issue.updatedAt, triageAttempts: 0, gatePendingAttempts: 0, stage: stageOf(workflowFor(workspace), issue.labels), rank: await lastRankAfter(payload, workspace) },
    null,
  )
  await record(payload, ticket.id, { cause: 'setup' })
  revalidateSetup()
  redirect('/setup')
})

'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { upsertTicket, lastRankAfter, ticketsOf } from '../../../../lib/actions'
import { activeVersion, applyFactory, workflowFor } from '../../../../lib/factory'
import { record } from '../../../../lib/history'
import { personOf } from '../../../../lib/person'
import { isPreset, presetSource, PRESET_TEXT } from '../../../../lib/presets'
import { stageOf } from '../../../../lib/stage-move'
import { startVerifyCreate } from '../../../../lib/verify-create'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { loadSetup, SKIP_SESSION, SKIP_VERIFY } from '../../lib/setup'
import { only, run, type FormState } from '../../lib/settings'

type Form = (prev: FormState, fd: FormData) => Promise<FormState>

const revalidateSetup = () => ['/setup', '/team', '/'].forEach((p) => revalidatePath(p))

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

export const applyPreset = act(async ({ user, workspace, payload }, fd) => {
  const id = String(fd.get('preset'))
  if (!isPreset(id)) throw new Error('Choose a team.')
  const r = await applyFactory(payload, workspace, presetSource(id), { by: personOf(user), via: 'ui', note: `Setup: ${PRESET_TEXT[id].title} team`, baseVersion: (await activeVersion(payload, workspace))?.version ?? null })
  if (!r.ok) throw new Error(r.findings.join('\n'))
  revalidatePath('/settings', 'layout')
})

export const skipSession = act(async ({ user, workspace, payload }) => {
  await payload.create({ collection: 'human_touches', data: { kind: SKIP_SESSION, workspace, actor: personOf(user), at: new Date().toISOString() }, overrideAccess: true })
})

export const skipVerify = act(async ({ user, workspace, payload }) => {
  await payload.create({ collection: 'human_touches', data: { kind: SKIP_VERIFY, workspace, actor: personOf(user), at: new Date().toISOString() }, overrideAccess: true })
})

export const generateVerification = act(async ({ workspace, payload }) => {
  const { product } = await loadSetup(workspace)
  if (!product) throw new Error('Pick a product first.')
  await startVerifyCreate(payload, product.id)
})

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

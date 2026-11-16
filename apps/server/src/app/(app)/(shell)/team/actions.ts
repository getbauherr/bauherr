'use server'
import { revalidatePath } from 'next/cache'
import { applyFactory, activeVersion, exportFactory, workflowFor } from '../../../../lib/factory'
import { NotReleasable, releaseLock } from '../../../../lib/actions'
import { id } from '../../../../lib/release'
import { disconnect, sessionHealth } from '../../../../lib/sessions'
import { personOf } from '../../../../lib/person'
import type { RoleSettings, SaveResult } from '../../components/team/types'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { isAdmin } from '../../lib/settings'
import { withRoleSettings } from '../../lib/team'

/** Admin: changes a role's model and agent cap by rewriting the Workspace's factory file and applying it (version note "Team: <role> model/agents"), so the file stays the single source. Lint findings come back as the error text. */
export const saveRole = async (roleId: string, settings: RoleSettings): Promise<SaveResult> => {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) return { error: 'Only an Admin can change a role.' }
  if (!workspace) return { error: 'No Workspace selected.' }
  const role = workflowFor(workspace.id).roles.find((r) => r.id === roleId)
  if (!role) return { error: `Role "${roleId}" is not in the workflow.` }
  const payload = await payloadClient()
  let yaml: string
  try {
    yaml = withRoleSettings(await exportFactory(payload, workspace.id), roleId, settings)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const r = await applyFactory(payload, workspace.id, yaml, { by: personOf(user), via: 'ui', note: `Team: ${role.title} model/agents`, baseVersion: (await activeVersion(payload, workspace.id))?.version ?? null })
  if (!r.ok) return { error: r.findings.join('\n') }
  if (r.changed) {
    revalidatePath('/team')
    revalidatePath('/settings', 'layout')
    revalidatePath('/')
  }
}

/** The Admin's session of the selected Workspace by public id; null for anyone else or a foreign id. */
const adminSession = async (publicId: string) => {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user) || !workspace) return null
  const payload = await payloadClient()
  const session = (await payload.find({ collection: 'agent_sessions', where: { and: [{ publicId: { equals: publicId } }, { workspace: { equals: workspace.id } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
  return session ? { payload, user, workspace, session: session as Record<string, any> } : null
}

/** Admin: ends the session; the Runs it holds go back to the queue. */
export const disconnectSession = async (publicId: string): Promise<SaveResult> => {
  const a = await adminSession(publicId)
  if (!a) return { error: 'Only an Admin can disconnect an agent.' }
  const owner = await a.payload.findByID({ collection: 'bauherren', id: id(a.session.owner), depth: 0, overrideAccess: true }).catch(() => a.user)
  await disconnect({ payload: a.payload, user: owner as Record<string, any>, actor: { kind: 'human' }, workspace: a.workspace.id }, a.session)
  revalidatePath(`/team/${publicId}`)
  revalidatePath('/team')
}

/** Admin: force-releases the lock of the session's running Run (the session is gone or silent). */
export const releaseSessionLock = async (publicId: string): Promise<SaveResult> => {
  const a = await adminSession(publicId)
  if (!a) return { error: 'Only an Admin can release a lock.' }
  const run = (await a.payload.find({ collection: 'runs', where: { and: [{ session: { equals: a.session.id } }, { status: { equals: 'running' } }, { workspace: { equals: a.workspace.id } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
  if (!run) return { error: 'This agent holds no running Run.' }
  if (sessionHealth({ hasRun: true, lastSeenAt: a.session.lastSeenAt, disconnectedAt: a.session.disconnectedAt }) === 'working') return { error: 'The agent is still responding.' }
  try {
    await releaseLock(a.payload, a.user, { runId: run.id })
  } catch (e) {
    if (e instanceof NotReleasable) return { error: 'The Run is no longer running.' }
    throw e
  }
  revalidatePath(`/team/${publicId}`)
  revalidatePath('/team')
}

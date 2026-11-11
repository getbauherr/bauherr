'use server'
import { revalidatePath } from 'next/cache'
import { applyFactory, activeVersion, exportFactory, workflowFor } from '../../../../lib/factory'
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

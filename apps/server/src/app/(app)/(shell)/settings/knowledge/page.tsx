import Link from 'next/link'
import { Suspense } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { KnowledgeRepo } from '../../../components/KnowledgeRepo'
import { SettingsForm } from '../../../components/SettingsForm'
import { isAdmin, listRepos, loadWorkspaceSettings } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { notFound } from 'next/navigation'
import { saveKnowledge } from '../actions'

export const dynamic = 'force-dynamic'

type Settings = Awaited<ReturnType<typeof loadWorkspaceSettings>>

/** The repository list comes from the forge: the picker renders at once and receives it when it arrives. */
async function LoadedRepo({ w }: { w: Settings }) {
  const repos = w.knowledgeConnection ? await listRepos(Number(w.knowledgeConnection)) : null
  return <KnowledgeRepo connections={w.githubConnections} connection={w.knowledgeConnection} repos={repos} repo={w.knowledgeRepo} />
}

export default async function KnowledgeSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const w = await loadWorkspaceSettings(workspace.id)
  return (
    <>
      <h2 className="heading">Knowledge</h2>
      <p className="small text-muted-foreground">The repository whose Markdown documents the agents read and the Workspace searches. {w.knowledgeRepo ? <Link href="/knowledge" className="text-primary">Open the Knowledge page</Link> : 'Connect a repository to add your own documents.'}</p>
      <SettingsForm action={saveKnowledge} submit="Save" primary>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Suspense fallback={<KnowledgeRepo connections={w.githubConnections} connection={w.knowledgeConnection} repos="loading" repo={w.knowledgeRepo} />}>
            <LoadedRepo w={w} />
          </Suspense>
        </div>
      </SettingsForm>
    </>
  )
}

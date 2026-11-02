import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { KnowledgeEditor } from '../../../components/KnowledgeEditor'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { EditRefused, loadDocument } from '../../../../../lib/knowledge-edit'

export const dynamic = 'force-dynamic'

export default async function EditKnowledge({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  const { path } = await searchParams
  const { user, workspace } = await currentWorkspace()
  if (!workspace || !path) notFound()
  try {
    const doc = await loadDocument(await payloadClient(), user, workspace.id, path)
    return (
      <>
        <h2 className="heading">Edit {path}</h2>
        <p className="small muted">Saving opens a pull request on the Knowledge repo; it merges when its checks are green.</p>
        <KnowledgeEditor path={path} content={doc.content} sha={doc.sha} />
      </>
    )
  } catch (e) {
    if (e instanceof EditRefused) return <EmptyState text={e.message} />
    throw e
  }
}

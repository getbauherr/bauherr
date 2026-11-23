import { mayDecide } from '../../../../../core/decide'
import { RecordNotFound } from '../../../../../core/record/errors'
import { ticket } from '../../../../../core/views/ticket'
import { AutoRefresh } from '../../../components/AutoRefresh'
import { EmptyState } from '../../../components/EmptyState'
import { PageTitle } from '../../../components/PageTitle'
import { ArchiveControl } from '../../../components/ticket/ArchiveControl'
import { NowPane } from '../../../components/ticket/NowPane'
import { SideColumn } from '../../../components/ticket/SideColumn'
import { ActivityTab, BriefTab, ResultTab } from '../../../components/ticket/TabPanels'
import { TicketHeader } from '../../../components/ticket/TicketHeader'
import { TicketTabs } from '../../../components/ticket/TicketTabs'
import { parseTab } from '../../../lib/ticket'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; proof?: string }> }

const GONE = { href: '/', label: 'Back to the Factory' }

export default async function TicketPage({ params, searchParams }: Props) {
  const { user, workspace } = await currentWorkspace()
  const recordId = Number((await params).id)
  if (!workspace || !Number.isInteger(recordId) || recordId <= 0) {
    return <EmptyState text="This ticket does not exist." action={GONE} />
  }
  const view = await ticket(await payloadClient(), { workspace: workspace.id, recordId }).catch((error: unknown) => {
    if (error instanceof RecordNotFound) return null
    throw error
  })
  if (!view) return <EmptyState text="This ticket does not exist." action={GONE} />
  const { tab, proof } = await searchParams
  const current = parseTab(tab)
  const may = mayDecide({ id: String(user.id), role: user.role, workspaceIds: [workspace.id] }, workspace.id)
  return (
    <>
      <PageTitle>{`#${view.number}`}</PageTitle>
      <TicketHeader view={view} />
      <TicketTabs recordId={recordId} current={current} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-4">
          {current === 'now' && <NowPane view={view} proof={proof} may={may} />}
          {current === 'now' && <ArchiveControl view={view} may={may} />}
          {current === 'brief' && <BriefTab view={view} />}
          {current === 'result' && <ResultTab view={view} proof={proof} />}
          {current === 'activity' && <ActivityTab view={view} />}
        </div>
        <SideColumn view={view} />
      </div>
      <AutoRefresh />
    </>
  )
}

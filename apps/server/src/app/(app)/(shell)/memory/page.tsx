import Link from 'next/link'
import { mayDecide } from '../../../../core/decide'
import {
  DOCUMENT_MAX_LINES,
  documentVersions,
  readDocument,
  type DocumentTarget,
  type DocumentVersion,
} from '../../../../core/memory-documents'
import { instructionFilesOf } from '../../../../core/views/instruction-files'
import { memoryProducts } from '../../../../core/views/statement-records'
import { EmptyState } from '../../components/EmptyState'
import { MemoryEditor } from '../../components/memory/MemoryEditor'
import { MemorySide } from '../../components/memory/MemorySide'
import type { VersionRow } from '../../components/memory/MemoryVersions'
import { ScopeSelect } from '../../components/memory/ScopeSelect'
import { PageTitle } from '../../components/PageTitle'
import { Button } from '../../components/ui/button'
import { lineCount } from '../../lib/memory-checks'
import { pickScope, scopeOptions, type ScopeOption } from '../../lib/memory-scope'
import { shortDate } from '../../lib/format'
import { currentWorkspace, payloadClient, type Bauherr } from '../../lib/session'
import type { DocumentChoice } from './document-actions'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ scope?: string; product?: string }> }

const FACTORY_ONLY = 'Only an Admin changes the factory document.'
const BAUHERR_ONLY = 'Only a Bauherr of this Workspace changes this document.'

const targetOf = (choice: DocumentChoice, workspace: number): DocumentTarget =>
  choice.scope === 'factory'
    ? { scope: 'factory' }
    : choice.scope === 'workspace' || choice.product === undefined
      ? { scope: 'workspace', workspace }
      : { scope: 'product', workspace, product: choice.product }

const peopleOf = async (versions: DocumentVersion[]): Promise<Map<string, string>> => {
  const ids = [...new Set(versions.map((version) => version.author))].map(Number).filter(Number.isInteger)
  if (ids.length === 0) return new Map()
  const found = await (
    await payloadClient()
  ).find({ collection: 'bauherren', where: { id: { in: ids } }, pagination: false, depth: 0, overrideAccess: true })
  return new Map(found.docs.map((doc) => [String(doc.id), doc.email]))
}

const who = (version: DocumentVersion, me: string, people: Map<string, string>): string =>
  version.reason === 'retro' ? 'Retro' : version.author === me ? 'you' : (people.get(version.author) ?? 'someone')

const rowsOf = (versions: DocumentVersion[], me: string, people: Map<string, string>): VersionRow[] =>
  versions.map((version, index) => ({
    id: version.id,
    number: versions.length - index,
    body: version.body,
    label: who(version, me, people),
    date: shortDate(version.at),
  }))

const lastChange = (version: DocumentVersion | undefined, me: string, people: Map<string, string>): string | null =>
  version
    ? `${who(version, me, people).replace(/^you$/, 'You')}, ${shortDate(version.at)}, ${
        version.reason === 'retro' ? 'agreed in a Retro' : 'edited directly'
      }`
    : null

async function Document({ current, workspace, user }: { current: ScopeOption; workspace: number; user: Bauherr }) {
  const payload = await payloadClient()
  const target = targetOf(current.choice, workspace)
  const [body, versions] = await Promise.all([readDocument(payload, target), documentVersions(payload, target)])
  const repoFiles = target.scope === 'product' ? await instructionFilesOf(payload, workspace, target.product) : null
  const me = String(user.id)
  const people = await peopleOf(versions)
  const person = { id: me, role: user.role, workspaceIds: [workspace] }
  const mayChange = target.scope === 'factory' ? user.role === 'admin' : mayDecide(person, workspace)
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <MemoryEditor
        key={`${current.value}-${versions[0]?.id ?? 0}`}
        choice={current.choice}
        initial={body}
        maxLines={DOCUMENT_MAX_LINES}
        mayChange={mayChange}
        whoMay={target.scope === 'factory' ? FACTORY_ONLY : BAUHERR_ONLY}
      />
      <MemorySide
        versions={rowsOf(versions, me, people)}
        last={lastChange(versions[0], me, people)}
        lines={lineCount(body)}
        maxLines={DOCUMENT_MAX_LINES}
        repoFiles={repoFiles}
      />
    </div>
  )
}

export default async function MemoryPage({ searchParams }: Props) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const params = await searchParams
  const products = await memoryProducts(await payloadClient(), workspace.id)
  const options = scopeOptions(workspace.name, products)
  const current = pickScope(options, params.scope ?? (params.product ? `product-${params.product}` : undefined))
  if (!current) return <EmptyState text="You have no Workspace yet." />
  return (
    <>
      <PageTitle>Memory</PageTitle>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Memory</h1>
        <ScopeSelect value={current.value} options={options} />
        <Button variant="outline" className="ml-auto" asChild>
          <Link href="/memory/retro">Retro</Link>
        </Button>
      </div>
      <Document current={current} workspace={workspace.id} user={user} />
    </>
  )
}

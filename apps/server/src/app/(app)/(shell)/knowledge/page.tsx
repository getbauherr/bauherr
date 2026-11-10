import Link from 'next/link'
import { Suspense } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { Table } from '../../components/ui/table'
import { ConfirmButton } from '../../components/SettingsForm'
import { approveSkillProposalAction } from '../../lib/actions'
import { docKey, loadKnowledge, title, type KnowledgePage } from '../../lib/knowledge'
import { isAdmin } from '../../lib/settings'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

const href = (params: Record<string, string>) => `/knowledge?${new URLSearchParams(params)}`
const CHECKS = { green: ['ok', '✓ Checks passed'], pending: ['neutral', 'Checks running'], red: ['destructive', '× Checks failed'] } as const
const PROPOSAL = { proposed: ['neutral', 'Proposed'], replayed: ['ok', 'Replayed'], accepted: ['ok', 'Accepted'], rejected: ['destructive', 'Rejected'] } as const
const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`)
const STACK = 'flex flex-col gap-4'

const PROSE = 'max-w-[68ch] [overflow-wrap:anywhere] [&>*]:mx-0 [&>*]:mt-0 [&>*]:mb-4 [&_:is(h1,h2,h3)]:mt-6 [&_:is(h1,h2,h3)]:font-semibold [&_:is(code,pre)]:font-mono [&_:is(code,pre)]:text-[13px] [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:border [&_pre]:border-border [&_pre]:bg-secondary [&_pre]:p-3 [&_a]:text-primary'

async function WriteBacks({ data, repo }: { data: KnowledgePage['writeBacks']; repo: string }) {
  const writeBacks = await data
  return (
    <section className={STACK} aria-label="Write-backs">
      <h2 className="heading">Write-backs</h2>
      {writeBacks === null ? (
        <p className="small text-muted-foreground">The forge did not answer; open pull requests are not shown.</p>
      ) : writeBacks.length ? (
        <Table>
            <thead><tr className="label"><th>Pull request</th><th>Branch</th><th>Checks</th></tr></thead>
            <tbody>
              {writeBacks.map((p) => (
                <tr key={p.number}>
                  <td><a className="text-primary" href={p.url} rel="noopener noreferrer">#{p.number} {p.title}</a></td>
                  <td className="mono">{p.head}</td>
                  <td>
                    <Badge variant={CHECKS[p.checks][0]}>{CHECKS[p.checks][1]}</Badge>
                    {p.failed.length > 0 && <span className="small text-muted-foreground"> {p.failed.join(', ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
        </Table>
      ) : (
        <p className="small text-muted-foreground">No open write-backs in {repo}.</p>
      )}
    </section>
  )
}

async function Proposals({ data }: { data: KnowledgePage['proposals'] }) {
  const proposals = await data
  return proposals.length > 0 ? (
    <section className={STACK} aria-label="Skill proposals">
      <h2 className="heading">Skill proposals</h2>
      <Table>
        <thead><tr className="label"><th>Skill</th><th>From</th><th>Status</th><th>Score vs baseline</th><th>Pull request</th><th><span className="sr-only">Action</span></th></tr></thead>
        <tbody>
          {proposals.map((p) => {
            const [variant, label] = PROPOSAL[p.status as keyof typeof PROPOSAL]
            return (
              <tr key={p.id}>
                <td className="mono">{p.skill}</td>
                <td>{p.ticket}</td>
                <td><Badge variant={variant}>{label}</Badge></td>
                <td>{pct(p.score)} vs {pct(p.baseline)}</td>
                <td>{p.prUrl ? <a className="text-primary" href={p.prUrl} rel="noopener noreferrer">#{p.prNumber}</a> : p.prNumber != null && `#${p.prNumber}`}</td>
                <td>
                  {p.headSha && (
                    <form action={approveSkillProposalAction} className="flex gap-2">
                      <input type="hidden" name="proposal" value={p.id} />
                      <input type="hidden" name="expectSha" value={p.headSha} />
                      <ConfirmButton label="Approve" confirm="Confirm: merge this skill" primary />
                    </form>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </section>
  ) : null
}

export default async function Knowledge({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const admin = isAdmin(user)
  const { sources, repo, hits, doc, writeBacks, proposals } = await loadKnowledge(workspace.id, sp.q, sp.doc, { admin })
  const q = sp.q?.trim() ?? ''
  return (
    <>
      <h1 className="title">Knowledge</h1>
      <form className="flex items-center gap-4" action="/knowledge" role="search">
        <label className="flex flex-col gap-1">
          <span className="sr-only">Search Knowledge</span>
          <Input name="q" type="search" defaultValue={q} placeholder="Search Knowledge" />
        </label>
        <Button type="submit">Search</Button>
      </form>
      {!repo && (admin
        ? <EmptyState text="Only the built-in documents are available. Connect a Knowledge repo to add your own documents." action={{ href: '/settings/workspace', label: 'Open settings' }} />
        : !sources.length && <EmptyState text="No documents yet." />)}
      <div className="grid grid-cols-[260px_minmax(0,1fr)] items-start gap-8 max-sm:grid-cols-[minmax(0,1fr)] max-sm:gap-4">
        <nav className={STACK} aria-label="Documents">
          {sources.map((s) => (
            <section key={s.name} className={STACK}>
              <h2 className="label text-muted-foreground">{s.label}</h2>
              <ul className="m-0 flex list-none flex-col p-0">
                {s.docs.map((d) => (
                  <li key={d.path}>
                    <Link className="block border-l border-l-border px-3 py-1 text-muted-foreground transition-colors duration-(--duration-state) ease-(--ease-out) [overflow-wrap:anywhere] hover:text-foreground aria-[current]:border-l-primary aria-[current]:text-foreground" href={href({ doc: docKey(d) })} aria-current={doc && docKey(doc) === docKey(d) ? 'page' : undefined}>{d.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className={STACK}>
          {hits && (
            <section className={STACK} aria-label="Search results">
              <h2 className="heading">{hits.length} {hits.length === 1 ? 'result' : 'results'} for “{q}”</h2>
              {hits.map((h, i) => (
                <Card asChild key={i} className="gap-4">
                  <article>
                  <Link className="text-primary" href={href({ doc: docKey(h), q })}>{h.heading || title(h.path)}</Link>
                  <p className="small">{h.text.replace(/^#.*\n/, '').trim().slice(0, 240)}</p>
                  </article>
                </Card>
              ))}
            </section>
          )}
          {doc ? (
            <article className={STACK} aria-label={doc.title}>
              <div className={PROSE} dangerouslySetInnerHTML={{ __html: doc.html }} />
            </article>
          ) : (
            !hits && sp.doc && <p className="text-muted-foreground">That document is not in the index.</p>
          )}
          {!hits && !doc && !sp.doc && <p className="text-muted-foreground">Search, or pick a document on the left.</p>}
        </div>
      </div>
      {admin && repo && (
        <>
          <Suspense fallback={<Skeleton className="h-24 w-full" />}>
            <WriteBacks data={writeBacks} repo={repo} />
          </Suspense>
          <Suspense>
            <Proposals data={proposals} />
          </Suspense>
        </>
      )}
    </>
  )
}

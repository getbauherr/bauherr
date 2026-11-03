import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { docKey, loadKnowledge } from '../../lib/knowledge'
import { repoOf } from '../../../../lib/knowledge'
import { isAdmin } from '../../lib/settings'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

const href = (params: Record<string, string>) => `/knowledge?${new URLSearchParams(params)}`
const CHECKS = { green: ['succeeded', '✓ Checks passed'], pending: ['running', 'Checks running'], red: ['failed', '× Checks failed'] } as const

export default async function Knowledge({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const { sources, repo, hits, doc, writeBacks } = await loadKnowledge(workspace.id, sp.q, sp.doc)
  const q = sp.q?.trim() ?? ''
  return (
    <>
      <h1 className="title">Knowledge</h1>
      <form className="sform inline" action="/knowledge" role="search">
        <label className="field">
          <span className="sr">Search Knowledge</span>
          <input name="q" type="search" defaultValue={q} placeholder="Search Knowledge" />
        </label>
        <button className="btn primary" type="submit">Search</button>
      </form>
      {!repo && (isAdmin(user)
        ? <EmptyState text="Only the core pack is available. Connect a Knowledge repo to add your own documents." action={{ href: '/settings/workspace', label: 'Open settings' }} />
        : <EmptyState text="No documents yet." />)}
      <div className="kb">
        <nav className="stack" aria-label="Documents">
          {sources.map((s) => (
            <section key={s.name} className="stack">
              <h2 className="label muted">{s.name === 'core' ? 'Core pack' : repoOf(s.name)}</h2>
              <ul className="kb-docs">
                {s.docs.map((d) => (
                  <li key={d.path}>
                    <Link href={href({ doc: docKey(d) })} aria-current={doc && docKey(doc) === docKey(d) ? 'page' : undefined}>{d.path}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className="stack">
          {hits && (
            <section className="stack" aria-label="Search results">
              <h2 className="heading">{hits.length} {hits.length === 1 ? 'result' : 'results'} for “{q}”</h2>
              {hits.map((h, i) => (
                <article key={i} className="card-lg stack">
                  <Link className="link" href={href({ doc: docKey(h), q })}>{h.heading || h.path}</Link>
                  <p className="small muted mono">{repoOf(h.source)} · {h.path} · {h.commit.slice(0, 7)}</p>
                  <p className="small">{h.text.replace(/^#.*\n/, '').trim().slice(0, 240)}</p>
                </article>
              ))}
            </section>
          )}
          {doc ? (
            <article className="stack" aria-label={doc.path}>
              <p className="small muted mono">{repoOf(doc.source)} · {doc.path} · {doc.commit.slice(0, 7)}</p>
              <div className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
            </article>
          ) : (
            !hits && sp.doc && <p className="muted">That document is not in the index.</p>
          )}
          {!hits && !doc && !sp.doc && <p className="muted">Search, or pick a document on the left.</p>}
        </div>
      </div>
      {repo && (
        <section className="stack" aria-label="Write-backs">
          <h2 className="heading">Write-backs</h2>
          {writeBacks === null ? (
            <p className="muted small">The forge did not answer; open pull requests are not shown.</p>
          ) : writeBacks.length ? (
            <div className="scroll">
              <table className="table">
                <thead><tr><th>Pull request</th><th>Branch</th><th>Checks</th></tr></thead>
                <tbody>
                  {writeBacks.map((p) => (
                    <tr key={p.number}>
                      <td><a className="link" href={p.url} rel="noopener noreferrer">#{p.number} {p.title}</a></td>
                      <td className="mono">{p.head}</td>
                      <td>
                        <span className={`chip label ${CHECKS[p.checks][0]}`}>{CHECKS[p.checks][1]}</span>
                        {p.failed.length > 0 && <span className="small muted"> {p.failed.join(', ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">No open write-backs in {repo}.</p>
          )}
        </section>
      )}
    </>
  )
}

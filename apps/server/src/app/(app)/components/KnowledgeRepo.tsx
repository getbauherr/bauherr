'use client'
import { useEffect, useRef, useState } from 'react'
import { repositoriesOf } from '../(shell)/settings/actions'
import { Field, PickField } from './SettingsForm'

type Listing = string[] | null | 'loading'

/** Connection select and Repository select of the Knowledge repo; the repositories are listed again when the Connection changes, and a typed `owner/name` stays possible. */
export function KnowledgeRepo({ connections, connection, repos, repo }: { connections: [string, string][]; connection: string; repos: Listing; repo: string }) {
  const [conn, setConn] = useState(connection)
  const [listing, setListing] = useState<Listing>(repos)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    let current = true
    if (!conn) return setListing(null)
    setListing('loading')
    repositoriesOf(Number(conn)).then((r) => current && setListing(r), () => current && setListing(null))
    return () => {
      current = false
    }
  }, [conn])
  return (
    <>
      <Field name="knowledgeConnection" label="Connection" options={connections} empty="none" defaultValue={connection} onChange={(e) => setConn(e.target.value)} />
      {listing === 'loading' ? (
        <>
          <input type="hidden" name="knowledgeRepo" value={repo} />
          <p role="status" className="small text-muted-foreground">Reading repositories...</p>
        </>
      ) : (
        <PickField key={`${conn}-${listing?.length ?? 'x'}`} name="knowledgeRepo" label="Repository" options={listing} defaultValue={repo} hint={listing === null && conn ? 'Could not list repositories; type owner/name.' : undefined} example="acme/knowledge" />
      )}
    </>
  )
}

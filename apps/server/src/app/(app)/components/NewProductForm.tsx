'use client'
import { useEffect, useState } from 'react'
import { createProductWithRepo, repositoriesOf } from '../(shell)/settings/actions'
import { OTHER_REPO, slugOf } from '../lib/new-product'
import { Field, SettingsForm } from './SettingsForm'

type Listing = string[] | null | 'loading'

/** `/settings/products/new`: Name, Connection, Repository (listed from the forge, "Other..." for a typed one) and the Advanced short name, derived from the name until edited. */
export function NewProductForm({ connections }: { connections: { id: number; name: string }[] }) {
  const [connection, setConnection] = useState(connections[0]!.id)
  const [listing, setListing] = useState<Listing>('loading')
  const [repo, setRepo] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)

  useEffect(() => {
    let current = true
    setListing('loading')
    setRepo('')
    repositoriesOf(connection).then((r) => current && setListing(r), () => current && setListing(null))
    return () => {
      current = false
    }
  }, [connection])

  const typed = listing === null || repo === OTHER_REPO || (Array.isArray(listing) && !listing.length)
  return (
    <SettingsForm action={createProductWithRepo} submit="Add Product" primary>
      <input type="hidden" name="open" value="1" />
      <Field name="name" label="Product name" hint="What you call this product on the Board and in Tickets." example="Acme Shop" required onChange={(e) => !slugEdited && setSlug(slugOf(e.target.value))} />
      {connections.length === 1 ? (
        <>
          <input type="hidden" name="connection" value={connection} />
          <p className="small">Account <span className="font-medium text-foreground">{connections[0]!.name}</span></p>
        </>
      ) : (
        <Field name="connection" label="Account" hint="The GitHub or GitLab account Bauherr uses to read and write this repository." options={connections.map((c) => [String(c.id), c.name])} defaultValue={String(connection)} onChange={(e) => setConnection(Number(e.target.value))} />
      )}
      {listing === 'loading' ? (
        <p role="status" className="small text-muted-foreground">Reading repositories...</p>
      ) : (
        <>
          {Array.isArray(listing) && listing.length > 0 && (
            <Field name="fullName" label="Repository" hint="The code repository the agents work in." options={[...listing.map((r): [string, string] => [r, r]), [OTHER_REPO, 'Other...']]} defaultValue={listing[0]} onChange={(e) => setRepo(e.target.value)} />
          )}
          {typed && (
            <Field name={listing === null || !listing.length ? 'fullName' : 'repoOther'} label={listing === null || !listing.length ? 'Repository' : 'Other repository'} hint={listing === null ? 'Could not list repositories; type owner/name.' : 'The code repository the agents work in, as owner/name.'} example="acme/shop" required />
          )}
        </>
      )}
      <details data-slot="advanced">
        <summary className="small cursor-pointer text-primary">Advanced</summary>
        <div className="mt-3">
          <Field name="slug" label="Short name" hint="Used in links and in the Knowledge repo folder products/<short name>/. It cannot change later." example="acme-shop" value={slug} onChange={(e) => (setSlugEdited(true), setSlug(e.target.value))} />
        </div>
      </details>
    </SettingsForm>
  )
}

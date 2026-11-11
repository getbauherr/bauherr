import { listRepos } from '../../lib/settings'

/** Streamed into `ProductPick`: the repositories of the account as datalist options, or the line that asks for a typed `owner/name`. The forge is asked once, 3 s at most, no retries. */
export async function RepoOptions({ connection }: { connection: number }) {
  const repos = await listRepos(connection)
  return repos ? (
    <datalist id="setup-repos">{repos.map((r) => <option key={r} value={r} />)}</datalist>
  ) : (
    <p className="small text-muted-foreground" role="status">Could not list repositories; type owner/name.</p>
  )
}

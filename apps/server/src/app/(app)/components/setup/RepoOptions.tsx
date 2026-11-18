import { listRepos } from '../../lib/settings'

export async function RepoOptions({ connection }: { connection: number }) {
  const repos = await listRepos(connection)
  return repos ? (
    <datalist id="setup-repos">{repos.map((r) => <option key={r} value={r} />)}</datalist>
  ) : (
    <p className="small text-muted-foreground" role="status">Could not list repositories; type owner/name.</p>
  )
}

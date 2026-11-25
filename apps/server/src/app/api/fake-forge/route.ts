export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = async (req: Request): Promise<Response> => {
  if (process.env.BAUHERR_E2E_FAKE_FORGE !== '1') return new Response(null, { status: 404 })
  const { forgeCalls, fakeForge } = await import('../../../lib/fake-forge')
  const { searchParams } = new URL(req.url)
  const repo = searchParams.get('repo')
  const number = searchParams.get('number')
  if (repo && number) {
    const { blockedBy, parent } = await fakeForge().tickets(repo).get(number)
    return Response.json({ blockedBy, parent })
  }
  const issues = repo ? await fakeForge().tickets(repo).list({ state: 'all' }) : []
  const shown = issues.map(({ number, title, body }) => ({ number, title, body }))
  return Response.json({ calls: forgeCalls(), issues: shown })
}

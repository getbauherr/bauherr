export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = async (req: Request): Promise<Response> => {
  if (process.env.BAUHERR_E2E_FAKE_FORGE !== '1') return new Response(null, { status: 404 })
  const { forgeCalls, fakeForge } = await import('../../../lib/fake-forge')
  const repo = new URL(req.url).searchParams.get('repo')
  const issues = repo ? await fakeForge().tickets(repo).list({ state: 'all' }) : []
  const shown = issues.map(({ number, title, body }) => ({ number, title, body }))
  return Response.json({ calls: forgeCalls(), issues: shown })
}

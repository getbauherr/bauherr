export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = async (request: Request): Promise<Response> => {
  if (process.env.BAUHERR_E2E_FAKE_FORGE !== '1') return new Response(null, { status: 404 })
  const { fakeForge, forgeCalls } = await import('../../../lib/fake-forge')
  const { searchParams } = new URL(request.url)
  const repo = searchParams.get('repo')
  const number = searchParams.get('number')
  if (repo && number) {
    const { blockedBy, parent } = await fakeForge().tickets(repo).get(number)
    return Response.json({ blockedBy, parent })
  }
  return Response.json({ calls: forgeCalls() })
}

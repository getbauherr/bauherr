export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = async (): Promise<Response> => {
  if (process.env.BAUHERR_E2E_FAKE_FORGE !== '1') return new Response(null, { status: 404 })
  const { forgeCalls } = await import('../../../lib/fake-forge')
  return Response.json({ calls: forgeCalls() })
}

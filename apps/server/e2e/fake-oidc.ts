import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.env.FAKE_OIDC_PORT ?? 4010)
const issuer = `http://localhost:${port}`
const clientId = 'bauherr'
const clientSecret = process.env.OIDC_CLIENT_SECRET ?? ''
const sub = process.env.FAKE_OIDC_SUB ?? 'po-oidc'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fake', alg: 'RS256', use: 'sig' }
const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url')
const codes = new Map<string, { nonce: string; challenge: string }>()
const roles = ['product-owner']
const claims = { email: `${sub}@example.com`, email_verified: true, resource_access: { bauherr: { roles } } }

const idToken = (nonce: string) => {
  const head = b64(JSON.stringify({ alg: 'RS256', kid: 'fake', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const body = b64(JSON.stringify({ ...claims, iss: issuer, sub, aud: clientId, nonce, iat: now, exp: now + 300 }))
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey, 'base64url')}`
}

const json = (res: import('node:http').ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

type Res = import('node:http').ServerResponse
type Req = import('node:http').IncomingMessage

const discovery = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  userinfo_endpoint: `${issuer}/userinfo`,
  jwks_uri: `${issuer}/jwks`,
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  token_endpoint_auth_methods_supported: ['client_secret_post'],
  code_challenge_methods_supported: ['S256'],
}

const authorize = (url: URL, res: Res) => {
  const code = randomBytes(16).toString('hex')
  const param = (k: string) => url.searchParams.get(k) ?? ''
  codes.set(code, { nonce: param('nonce'), challenge: param('code_challenge') })
  const back = new URL(param('redirect_uri'))
  back.searchParams.set('code', code)
  back.searchParams.set('state', param('state'))
  res.writeHead(302, { location: back.toString() }).end()
}

const token = async (req: Req, res: Res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const form = new URLSearchParams(raw)
  const field = (k: string) => form.get(k) ?? ''
  const pending = codes.get(field('code'))
  codes.delete(field('code'))
  const challenge = createHash('sha256').update(field('code_verifier')).digest('base64url')
  const credentials = field('client_id') === clientId && field('client_secret') === clientSecret
  const verified = pending && credentials && challenge === pending.challenge
  if (!verified) return json(res, 400, { error: 'invalid_grant' })
  json(res, 200, {
    access_token: randomBytes(16).toString('hex'),
    token_type: 'Bearer',
    expires_in: 300,
    id_token: idToken(pending.nonce),
  })
}

const routes: Record<string, (url: URL, req: Req, res: Res) => unknown> = {
  '/.well-known/openid-configuration': (_u, _q, res) => json(res, 200, discovery),
  '/jwks': (_u, _q, res) => json(res, 200, { keys: [jwk] }),
  '/authorize': (url, _q, res) => authorize(url, res),
  '/token': (_u, req, res) => token(req, res),
  '/userinfo': (_u, _q, res) => json(res, 200, { ...claims, sub }),
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', issuer)
  return (routes[url.pathname] ?? ((_u, _q, r) => json(r, 404, { error: 'not_found' })))(url, req, res)
}).listen(port)

import * as client from 'openid-client'
import type { Role } from './people'
import { fakeAllowed, TEST_BUILD } from './fake-guard'
import { secret } from './secrets'

const insecureIssuer = (): boolean =>
  process.env.BAUHERR_E2E_OIDC_INSECURE === '1' && fakeAllowed(process.env, TEST_BUILD)

const httpsUrl = (v?: string): boolean => {
  try {
    const { protocol } = new URL(v ?? '')
    return protocol === 'https:' || (protocol === 'http:' && insecureIssuer())
  } catch {
    return false
  }
}

const hasSecret = (): boolean => {
  try {
    return !!secret('OIDC_CLIENT_SECRET')
  } catch {
    return false
  }
}

export const oidcMissing = (): string | undefined =>
  !httpsUrl(process.env.OIDC_ISSUER)
    ? 'OIDC_ISSUER'
    : !process.env.OIDC_CLIENT_ID
      ? 'OIDC_CLIENT_ID'
      : !hasSecret()
        ? 'OIDC_CLIENT_SECRET'
        : !process.env.PUBLIC_URL
          ? 'PUBLIC_URL'
          : undefined

export const oidcEnabled = (): boolean => !oidcMissing()

let warned = false
export const warnIfMisconfigured = (logger: { warn: (m: string) => void }): void => {
  const missing = oidcMissing()
  if (warned || !missing || !process.env.OIDC_ISSUER) return
  warned = true
  logger.warn(`OIDC disabled: ${missing} is missing or invalid`)
}

export const oidcDisplayName = (): string => {
  if (process.env.OIDC_DISPLAY_NAME) return process.env.OIDC_DISPLAY_NAME
  try {
    return new URL(process.env.OIDC_ISSUER ?? '').host
  } catch {
    return ''
  }
}

export const publicUrl = (): string => process.env.PUBLIC_URL || 'http://localhost:3000'
export const redirectUri = (): string => `${publicUrl()}/auth/oidc/callback`

export const OIDC_COOKIE = 'bauherr-oidc'

type Claims = Record<string, unknown>

export const claimAt = (claims: Claims, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Claims)[k] : undefined), claims)

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

const claimedRole = (
  roles: string[],
  adminRole: string,
  productOwnerRole?: string,
  bauherrRole?: string,
): Role | undefined =>
  roles.includes(adminRole)
    ? 'admin'
    : productOwnerRole && roles.includes(productOwnerRole)
      ? 'product-owner'
      : !bauherrRole || roles.includes(bauherrRole)
        ? 'bauherr'
        : undefined

export const roleFrom = (
  claims: Claims,
  roleClaim = process.env.OIDC_ROLE_CLAIM || 'realm_access.roles',
  adminRole = process.env.OIDC_ADMIN_ROLE || 'bauherr-admin',
  productOwnerRole = process.env.OIDC_PRODUCT_OWNER_ROLE,
  bauherrRole = process.env.OIDC_BAUHERR_ROLE,
): Role | undefined => claimedRole(strings(claimAt(claims, roleClaim)), adminRole, productOwnerRole, bauherrRole)

export const roleRequired = (): boolean => !!process.env.OIDC_BAUHERR_ROLE

const roleClaim = () => process.env.OIDC_ROLE_CLAIM || 'realm_access.roles'
const workspaceClaim = () => process.env.OIDC_WORKSPACE_CLAIM || 'groups'

export const syncFrom = (claims: Claims): { role?: Role; slugs?: string[] } => ({
  ...((roleRequired() || Array.isArray(claimAt(claims, roleClaim()))) && { role: roleFrom(claims) }),
  ...(Array.isArray(claimAt(claims, workspaceClaim())) && { slugs: workspaceSlugsFrom(claims) }),
})

export const emailOk = (claims: Claims): boolean =>
  typeof claims.email === 'string' && !!claims.email && claims.email_verified === true

export const mergeClaims = (info: Claims, id: Claims): Claims => ({ ...info, ...id })

export const resolveAccount = (a: {
  subject: string
  email: string
  existingBySubject?: unknown
  existingByEmail?: unknown
}): { action: 'login' | 'create' | 'refuse'; reason?: 'link-required' } =>
  a.existingBySubject
    ? { action: 'login' }
    : a.existingByEmail
      ? { action: 'refuse', reason: 'link-required' }
      : { action: 'create' }

export const workspaceSlugsFrom = (claims: Claims, claim = process.env.OIDC_WORKSPACE_CLAIM || 'groups'): string[] =>
  strings(claimAt(claims, claim)).map((g) => g.replace(/^\//, ''))

let config: Promise<client.Configuration> | undefined
const discover = () =>
  (config ??= client
    .discovery(
      new URL(process.env.OIDC_ISSUER!),
      process.env.OIDC_CLIENT_ID!,
      undefined,
      client.ClientSecretPost(secret('OIDC_CLIENT_SECRET')),
      insecureIssuer() ? { execute: [client.allowInsecureRequests] } : undefined,
    )
    .catch((e) => {
      config = undefined
      throw e
    }))

export type OidcTransaction = { state: string; nonce: string; verifier: string }

export const beginLogin = async (): Promise<{ url: URL; tx: OidcTransaction }> => {
  const tx = { state: client.randomState(), nonce: client.randomNonce(), verifier: client.randomPKCECodeVerifier() }
  const url = client.buildAuthorizationUrl(await discover(), {
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(tx.verifier),
    code_challenge_method: 'S256',
  })
  return { url, tx }
}

export const finishLogin = async (current: URL, tx: OidcTransaction): Promise<Claims> => {
  const cfg = await discover()
  const tokens = await client.authorizationCodeGrant(cfg, current, {
    pkceCodeVerifier: tx.verifier,
    expectedState: tx.state,
    expectedNonce: tx.nonce,
    idTokenExpected: true,
  })
  const id = tokens.claims()!
  const info = await client.fetchUserInfo(cfg, tokens.access_token, id.sub)
  return mergeClaims(info, id)
}

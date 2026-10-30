import * as client from 'openid-client'
import { secret } from './secrets'

const httpsUrl = (v?: string): boolean => {
  try {
    return new URL(v ?? '').protocol === 'https:'
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

/** Name of the first missing or invalid variable, or undefined when OIDC is fully configured. */
export const oidcMissing = (): string | undefined =>
  !httpsUrl(process.env.OIDC_ISSUER) ? 'OIDC_ISSUER' : !process.env.OIDC_CLIENT_ID ? 'OIDC_CLIENT_ID' : !hasSecret() ? 'OIDC_CLIENT_SECRET' : !process.env.PUBLIC_URL ? 'PUBLIC_URL' : undefined

export const oidcEnabled = (): boolean => !oidcMissing()

let warned = false
/** Logs once which variable disables OIDC, only when some OIDC variable is set. */
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

/** Reads a dot path (`realm_access.roles`) from the claims. */
export const claimAt = (claims: Claims, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Claims)[k] : undefined), claims)

const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export const roleFrom = (claims: Claims, roleClaim = process.env.OIDC_ROLE_CLAIM || 'realm_access.roles', adminRole = process.env.OIDC_ADMIN_ROLE || 'bauherr-admin'): 'admin' | 'bauherr' =>
  strings(claimAt(claims, roleClaim)).includes(adminRole) ? 'admin' : 'bauherr'

const roleClaim = () => process.env.OIDC_ROLE_CLAIM || 'realm_access.roles'
const workspaceClaim = () => process.env.OIDC_WORKSPACE_CLAIM || 'groups'

/** Only the claims that are present: an absent claim keeps the stored value. */
export const syncFrom = (claims: Claims): { role?: 'admin' | 'bauherr'; slugs?: string[] } => ({
  ...(Array.isArray(claimAt(claims, roleClaim())) && { role: roleFrom(claims) }),
  ...(Array.isArray(claimAt(claims, workspaceClaim())) && { slugs: workspaceSlugsFrom(claims) }),
})

export const emailOk = (claims: Claims): boolean => typeof claims.email === 'string' && !!claims.email && claims.email_verified === true

/** ID-token claims win over userinfo. */
export const mergeClaims = (info: Claims, id: Claims): Claims => ({ ...info, ...id })

export const resolveAccount = (a: { subject: string; email: string; existingBySubject?: unknown; existingByEmail?: unknown }): { action: 'login' | 'create' | 'refuse'; reason?: 'link-required' } =>
  a.existingBySubject ? { action: 'login' } : a.existingByEmail ? { action: 'refuse', reason: 'link-required' } : { action: 'create' }

/** Group values with a leading `/` stripped (Keycloak group paths). */
export const workspaceSlugsFrom = (claims: Claims, claim = process.env.OIDC_WORKSPACE_CLAIM || 'groups'): string[] => strings(claimAt(claims, claim)).map((g) => g.replace(/^\//, ''))

let config: Promise<client.Configuration> | undefined
const discover = () =>
  (config ??= client.discovery(new URL(process.env.OIDC_ISSUER!), process.env.OIDC_CLIENT_ID!, undefined, client.ClientSecretPost(secret('OIDC_CLIENT_SECRET'))).catch((e) => {
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

/** Exchanges the code (checks state, nonce, iss, PKCE) and returns the merged claims; a userinfo failure fails the login. */
export const finishLogin = async (current: URL, tx: OidcTransaction): Promise<Claims> => {
  const cfg = await discover()
  const tokens = await client.authorizationCodeGrant(cfg, current, { pkceCodeVerifier: tx.verifier, expectedState: tx.state, expectedNonce: tx.nonce, idTokenExpected: true })
  const id = tokens.claims()!
  const info = await client.fetchUserInfo(cfg, tokens.access_token, id.sub)
  return mergeClaims(info, id)
}

import * as client from 'openid-client'
import { secret } from './secrets'

export const oidcEnabled = (): boolean => !!process.env.OIDC_ISSUER

export const oidcDisplayName = (): string => process.env.OIDC_DISPLAY_NAME || (process.env.OIDC_ISSUER ? new URL(process.env.OIDC_ISSUER).host : '')

export const publicUrl = (): string => process.env.PUBLIC_URL || 'http://localhost:3000'
export const redirectUri = (): string => `${publicUrl()}/auth/oidc/callback`

export const OIDC_COOKIE = 'bauherr-oidc'

type Claims = Record<string, unknown>

/** Reads a dot path (`realm_access.roles`) from the claims. */
export const claimAt = (claims: Claims, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Claims)[k] : undefined), claims)

const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export const roleFrom = (claims: Claims, roleClaim = process.env.OIDC_ROLE_CLAIM || 'realm_access.roles', adminRole = process.env.OIDC_ADMIN_ROLE || 'bauherr-admin'): 'admin' | 'bauherr' =>
  strings(claimAt(claims, roleClaim)).includes(adminRole) ? 'admin' : 'bauherr'

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

/** Exchanges the code (checks state, nonce, iss, PKCE) and returns the merged ID token + userinfo claims. */
export const finishLogin = async (current: URL, tx: OidcTransaction): Promise<Claims> => {
  const cfg = await discover()
  const tokens = await client.authorizationCodeGrant(cfg, current, { pkceCodeVerifier: tx.verifier, expectedState: tx.state, expectedNonce: tx.nonce, idTokenExpected: true })
  const id = tokens.claims()!
  const info = await client.fetchUserInfo(cfg, tokens.access_token, id.sub).catch(() => ({}))
  return { ...id, ...info }
}

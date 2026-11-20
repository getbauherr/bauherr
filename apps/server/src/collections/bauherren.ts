import {
  addDataAndFileToRequest,
  generatePayloadCookie,
  headersWithCors,
  type CollectionConfig,
  type PayloadHandler,
} from 'payload'
import { clientIp, LoginBusy, signInWithPassword } from '../lib/login-lock'
import { oidcStrategy, SESSION_TTL_S } from '../lib/oidc-session'
import { ROLES } from '../lib/people'
import { isAdmin } from './access'
import { refuseLockedCredential, shapeAccount, validateAccount } from './bauherren-hooks'
import { json, rel, select, text } from './fields'

const login: PayloadHandler = async (req) => {
  await addDataAndFileToRequest(req)
  const { email, password } = (req.data ?? {}) as { email?: unknown; password?: unknown }
  let result
  try {
    result = await signInWithPassword(
      req.payload,
      typeof email === 'string' ? email : '',
      typeof password === 'string' ? password : '',
      clientIp(req.headers),
    )
  } catch (e) {
    if (e instanceof LoginBusy)
      return Response.json({ errors: [{ message: req.t('error:emailOrPasswordIncorrect') }] }, { status: 429 })
    throw e
  }
  const cookie = generatePayloadCookie({
    collectionAuthConfig: req.payload.collections.bauherren.config.auth,
    cookiePrefix: req.payload.config.cookiePrefix,
    token: result.token,
  })
  return Response.json(
    { message: req.t('authentication:passed'), ...result },
    { headers: headersWithCors({ headers: new Headers({ 'Set-Cookie': cookie }), req }) },
  )
}

export const bauherren: CollectionConfig = {
  slug: 'bauherren',
  labels: { singular: 'Bauherr', plural: 'Bauherren' },
  auth: { useAPIKey: true, strategies: [oidcStrategy], tokenExpiration: SESSION_TTL_S },
  admin: { useAsTitle: 'email' },
  endpoints: [{ path: '/login', method: 'post', handler: login }],
  access: {
    admin: isAdmin,
    create: isAdmin,
    delete: isAdmin,
    read: ({ req }) => (req.user?.role === 'admin' ? true : { id: { equals: req.user?.id } }),
    update: ({ req }) => (req.user?.role === 'admin' ? true : { id: { equals: req.user?.id } }),
  },
  hooks: {
    beforeValidate: [validateAccount],
    afterRead: [refuseLockedCredential],
    beforeChange: [shapeAccount],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      options: [...ROLES],
      defaultValue: 'bauherr',
      required: true,
      access: { create: isAdmin, update: isAdmin },
    },
    json('uiPrefs'),
    {
      name: 'assignments',
      type: 'array',
      access: { create: isAdmin, update: isAdmin },
      admin: {
        description:
          'Product owner only: per Workspace, all its Products (scope workspace) or the listed ones ' +
          '(scope products; an empty list grants nothing). ' +
          'Keeps `tenants` equal to the Workspaces listed here.',
      },
      fields: [
        rel('workspace', 'workspaces', { required: true }),
        select('scope', ['workspace', 'products'], { required: true }),
        rel('products', 'products', { hasMany: true }),
      ],
    },
    text('githubLogin', {
      admin: {
        description:
          'The forge login (GitHub, or GitLab username) linked to this account: ' +
          "a gate label or answers comment from it counts as this person's decision, " +
          'and it is assigned to Tickets when this Bauherr claims a session Run ' +
          '(falls back to BAUHERR_BOT_LOGIN). One account per login, case ignored.',
      },
    }),
    text('oidcSubject', {
      index: true,
      access: { create: isAdmin, update: isAdmin },
      admin: {
        description:
          'issuer|sub of the OIDC identity (Keycloak: <issuer>|<user ID>). ' +
          'Set on first SSO sign-in; Admins can set it to link an existing Bauherr.',
      },
    }),
    {
      name: 'sessionVersion',
      type: 'number',
      defaultValue: 0,
      access: { create: () => false, update: () => false },
      admin: { hidden: true },
    },
    {
      name: 'oidcSynced',
      type: 'date',
      access: { create: () => false, update: () => false },
      admin: { readOnly: true, description: 'Last OIDC sign-in that synced role and Workspaces.' },
    },
  ],
}

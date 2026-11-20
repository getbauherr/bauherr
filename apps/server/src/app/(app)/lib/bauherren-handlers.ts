import { randomBytes } from 'node:crypto'
import { withLoginLock } from '../../../lib/login-lock'
import { assignmentRows } from '../../../lib/people'
import { assertAnotherAdmin } from '../../../lib/settings-guards'
import { id, s, type Ctx } from './action-context'
import { only } from './settings'
import { workspacesOf } from './session'

type Account = { id: number; email: string; role: string; assignments?: unknown; githubLogin?: string | null }

const accountOf = async (c: Ctx, accountId: number): Promise<Account> =>
  (await c.payload.findByID({ collection: 'bauherren', id: accountId, depth: 0, overrideAccess: true })) as Account

const tenants = (fd: FormData) => fd.getAll('workspaces').map(Number)

const known = async (c: Ctx, ids: number[]) => {
  const own = (await workspacesOf(c.user)).map((w) => w.id)
  if (ids.some((i) => !own.includes(i))) throw new Error('Not in this Workspace')
}

const temporaryPassword = () => randomBytes(12).toString('base64url')
const shownOnce = (password: string) => `Temporary password (shown once): ${password}`

export const createBauherr = async (c: Ctx, fd: FormData) => {
  only(c.user)
  if (s(fd, 'role') !== 'admin' && s(fd, 'role') !== 'bauherr') throw new Error('Choose Admin or Bauherr.')
  await known(c, tenants(fd))
  const password = temporaryPassword()
  await c.payload.create({
    collection: 'bauherren',
    data: { email: s(fd, 'email'), password, role: s(fd, 'role'), tenants: tenants(fd).map((tenant) => ({ tenant })) },
    ...c.w,
  })
  return shownOnce(password)
}

const assignmentFrom = async (c: Ctx, fd: FormData) => {
  const workspace = Number(s(fd, 'workspace'))
  await known(c, [workspace])
  const scope = s(fd, 'scope') === 'workspace' ? 'workspace' : 'products'
  return { workspace, scope, products: scope === 'products' ? [...new Set(fd.getAll('products').map(Number))] : [] }
}

export const createProductOwner = async (c: Ctx, fd: FormData) => {
  only(c.user)
  const assignment = await assignmentFrom(c, fd)
  const password = temporaryPassword()
  await c.payload.create({
    collection: 'bauherren',
    data: { email: s(fd, 'email'), password, role: 'product-owner', assignments: [assignment] },
    ...c.w,
  })
  return shownOnce(password)
}

export const saveAssignment = async (c: Ctx, fd: FormData) => {
  only(c.user)
  const target = await accountOf(c, id(fd))
  if (target.role !== 'product-owner') throw new Error('Not a Product owner.')
  const workspace = Number(s(fd, 'workspace'))
  const rest = assignmentRows(target.assignments).filter((r) => r.workspace !== workspace)
  const assignments = s(fd, 'scope') === 'none' ? rest : [...rest, await assignmentFrom(c, fd)]
  await withLoginLock(target.email, () =>
    c.payload.update({ collection: 'bauherren', id: id(fd), data: { assignments }, ...c.w }),
  )
}

export const changeRole = async (c: Ctx, fd: FormData) => {
  only(c.user)
  const role = s(fd, 'role')
  if (role !== 'bauherr' && role !== 'product-owner') throw new Error('Choose Bauherr or Product owner.')
  if (id(fd) === c.user.id) throw new Error('You cannot change your own role.')
  const target = await accountOf(c, id(fd))
  if (target.role !== s(fd, 'from')) throw new Error('This account changed meanwhile. Reload the page.')
  if (target.role === 'admin') await assertAnotherAdmin(c.payload, id(fd))
  if (target.role !== role)
    await withLoginLock(target.email, () =>
      c.payload.update({ collection: 'bauherren', id: id(fd), data: { role }, ...c.w }),
    )
}

const assertMayEdit = async (c: Ctx, fd: FormData, target: Account, ids: number[]) => {
  if (target.role === 'product-owner') throw new Error('Use the Product owner form.')
  if (s(fd, 'role') !== 'admin' && s(fd, 'role') !== 'bauherr') throw new Error('Choose Admin or Bauherr.')
  if (id(fd) === c.user.id && s(fd, 'role') !== target.role) throw new Error('You cannot change your own role.')
  if (target.role === 'admin' && (s(fd, 'role') !== 'admin' || (id(fd) === c.user.id && !ids.length)))
    await assertAnotherAdmin(c.payload, id(fd))
}

export type LoginKnown = (c: Ctx, login: string) => Promise<boolean>

const assertLoginKnown = async (c: Ctx, login: string, current: string | undefined, knows: LoginKnown) => {
  if (login && login !== current && !(await knows(c, login)))
    throw Object.assign(new Error('GitHub login unknown.'), {
      data: { errors: [{ path: 'githubLogin', message: `GitHub does not know @${login}. Check the spelling.` }] },
    })
}

export const saveBauherr = (knows: LoginKnown) => async (c: Ctx, fd: FormData) => {
  only(c.user)
  const ids = tenants(fd)
  await known(c, ids)
  const target = await accountOf(c, id(fd))
  await assertMayEdit(c, fd, target, ids)
  const login = s(fd, 'githubLogin').replace(/^@/, '')
  await assertLoginKnown(c, login, target.githubLogin ?? undefined, knows)
  await withLoginLock(target.email, () =>
    c.payload.update({
      collection: 'bauherren',
      id: id(fd),
      data: {
        role: s(fd, 'role'),
        tenants: ids.map((tenant) => ({ tenant })),
        githubLogin: login || null,
        oidcSubject: s(fd, 'oidcSubject') || null,
      },
      ...c.w,
    }),
  )
}

export const unlockBauherr = async (c: Ctx, fd: FormData) => {
  only(c.user)
  const target = await accountOf(c, id(fd))
  await withLoginLock(target.email, () =>
    c.payload.update({
      collection: 'bauherren',
      id: id(fd),
      data: { lockUntil: null, loginAttempts: 0 },
      overrideAccess: true,
    }),
  )
}

import { redirect } from 'next/navigation'
import { markConnected } from '../../../core/intake/connected'
import { deleteProductMirror, deleteSourceMirror } from '../../../core/mirror/store'
import { parsePathSets, type PathSets } from '../../../lib/path-sets'
import { assertAnotherAdmin, assertInWorkspace, assertNoTickets, blockedBy } from '../../../lib/settings-guards'
import { fieldError, id, inWorkspace, inWs, s, type Ctx } from './action-context'
import { OTHER_REPO, slugOf } from './new-product'
import { only } from './settings'

export const savePathSets = async (c: Ctx, fd: FormData) => {
  only(c.user)
  const product = id(fd)
  await assertInWorkspace(c.payload, 'products', [product], inWorkspace(c))
  let pathSets: PathSets
  try {
    pathSets = parsePathSets(s(fd, 'sets'))
  } catch (e) {
    throw fieldError('sets', (e as Error).message)
  }
  await c.payload.update({ collection: 'products', id: product, data: { pathSets }, ...c.w })
}

const makeProduct = async (c: Ctx, fd: FormData) => {
  const name = s(fd, 'name')
  const slug = s(fd, 'slug') || slugOf(name)
  if (!/^[a-z0-9-]+$/.test(slug))
    throw Object.assign(new Error('Short name invalid.'), {
      data: { errors: [{ path: 'slug', message: 'Use lowercase letters, digits and dashes.' }] },
    })
  return (await c.payload.create({ collection: 'products', data: { name, slug, workspace: inWorkspace(c) }, ...c.w }))
    .id as number
}

const makeRepository = async (c: Ctx, product: number, fd: FormData) => {
  const connection = Number(s(fd, 'connection')) || undefined
  const fullName = s(fd, 'fullName')
  await inWs(c, 'connections', connection)
  const repo = await c.payload.create({
    collection: 'repositories',
    data: { fullName, product, workspace: inWorkspace(c) },
    ...c.w,
  })
  if (fd.get('readTickets') !== 'on') return
  try {
    await c.payload.create({
      collection: 'ticket_sources',
      data: { repo: fullName, connection, product, workspace: inWorkspace(c) },
      ...c.w,
    })
    await markConnected(c.payload, product, new Date())
  } catch (e) {
    await c.payload.delete({ collection: 'repositories', id: repo.id, ...c.w })
    throw e
  }
}

export const addRepository = async (c: Ctx, fd: FormData) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  const first = !(
    await c.payload.count({
      collection: 'ticket_sources',
      where: { product: { equals: id(fd) } },
      overrideAccess: true,
    })
  ).totalDocs
  await makeRepository(c, id(fd), fd)
  if (first && fd.get('readTickets') === 'on') redirect(`/settings/products/${id(fd)}/connect`)
}

const assertNewProductInput = async (c: Ctx, fd: FormData) => {
  const slug = s(fd, 'slug') || slugOf(s(fd, 'name'))
  if (
    (
      await c.payload.count({
        collection: 'products',
        where: { and: [{ slug: { equals: slug } }, { workspace: { equals: inWorkspace(c) } }] },
        overrideAccess: true,
      })
    ).totalDocs
  )
    throw fieldError('slug', 'Another Product already uses this short name.')
  if (s(fd, 'fullName') === OTHER_REPO) fd.set('fullName', s(fd, 'repoOther'))
  if (!s(fd, 'fullName')) throw fieldError('fullName', 'Choose a repository.')
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(s(fd, 'fullName')))
    throw fieldError('fullName', 'Use owner/name, for example acme/shop.')
}

export const createProductWithRepo = async (c: Ctx, fd: FormData) => {
  only(c.user)
  await assertNewProductInput(c, fd)
  const product = await makeProduct(c, fd)
  fd.set('readTickets', 'on')
  try {
    await makeRepository(c, product, fd)
  } catch (e) {
    await c.payload.delete({ collection: 'products', id: product, ...c.w })
    throw e
  }
  if (fd.get('open') === '1') redirect(`/settings/products/${product}/connect`)
}

const REMOVABLE = ['products', 'repositories', 'ticket_sources', 'bauherren'] as const
type Removable = (typeof REMOVABLE)[number]
const isRemovable = (collection: string): collection is Removable =>
  (REMOVABLE as readonly string[]).includes(collection)

const assertRemovable = async (c: Ctx, collection: Removable, docId: number) => {
  if (collection === 'bauherren') {
    if (docId === c.user.id) throw new Error('You cannot remove yourself.')
    await assertAnotherAdmin(c.payload, docId)
  } else await inWs(c, collection, docId)
  if (collection === 'products') {
    const blocked = await blockedBy(c.payload, 'products', docId)
    if (blocked) throw new Error(`Still referenced by ${blocked}.`)
    await assertNoTickets(c.payload, docId)
  }
}

export const removeDoc = async (c: Ctx, fd: FormData) => {
  only(c.user)
  const collection = s(fd, 'collection')
  if (!isRemovable(collection)) throw new Error('Unknown collection.')
  await assertRemovable(c, collection, id(fd))
  if (collection === 'ticket_sources') await deleteSourceMirror(c.payload, id(fd))
  if (collection === 'products') await deleteProductMirror(c.payload, id(fd))
  await c.payload.delete({ collection, id: id(fd), ...c.w })
  if (collection === 'products') redirect('/settings/products')
}

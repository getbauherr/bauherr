import { readFileSync, writeFileSync } from 'node:fs'
import { replaceVersion, stripBullets } from '../src/lib/changelog'

const file = new URL('../../../CHANGELOG.md', import.meta.url)
const slug = process.argv[2]
let md = stripBullets(readFileSync(file, 'utf8'))

if (slug) {
  const { getPayload } = await import('payload')
  const { default: config } = await import('../src/payload.config')
  const { forgeOf, id } = await import('../src/lib/release')
  const { renderNotes } = await import('../src/lib/ship-release')
  const { noteTemplates } = await import('../src/lib/templates')
  const payload = await getPayload({ config })
  const o = { overrideAccess: true, depth: 0 } as const
  const product = (await payload.find({ collection: 'products', where: { slug: { equals: slug } }, limit: 1, ...o })).docs[0]
  if (!product) throw new Error(`no Product ${slug}`)
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product.id } }, { releasedIn: { exists: true } }] }, sort: 'number', pagination: false, ...o })).docs as Record<string, any>[]
  const tpls = await noteTemplates(payload, id(product.workspace))
  const { tickets: ts } = await forgeOf(payload, product.id)
  for (const tag of new Set(tickets.map((t) => t.releasedIn as string))) {
    const batch = tickets.filter((t) => t.releasedIn === tag)
    const notes = await renderNotes(payload, product.id, ts, batch, tpls)
    md = replaceVersion(md, tag, notes)
    for (const t of batch.filter((x) => x.releaseNotes)) await payload.update({ collection: 'tickets', id: t.id, data: { releaseNotes: notes }, ...o })
  }
  await payload.destroy()
}

writeFileSync(file, md)

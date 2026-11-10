import { TEMPLATE_NAMES, type TemplateName, packTemplate } from '../../../lib/templates'
import { payloadClient } from './session'

type Doc = Record<string, any>

/** What the Settings pages show of a template: the pack default, and the Workspace's override when there is one. */
export const loadTemplates = async (workspace: number): Promise<{ name: TemplateName; title: string; usedBy: string; description: string; custom: { by: string | null; at: string } | null }[]> => {
  const rows = (await (await payloadClient()).find({ collection: 'templates', where: { workspace: { equals: workspace } }, select: { name: true, updatedBy: true, updatedAt: true }, depth: 0, pagination: false, overrideAccess: true })).docs as Doc[]
  return TEMPLATE_NAMES.map((name) => {
    const t = packTemplate(name)
    const row = rows.find((r) => r.name === name)
    return { name, title: t.title, usedBy: t.usedBy, description: t.description, custom: row ? { by: row.updatedBy ?? null, at: row.updatedAt } : null }
  })
}

export const loadTemplate = async (workspace: number, name: TemplateName) => {
  const pack = packTemplate(name)
  const row = (await (await payloadClient()).find({ collection: 'templates', where: { workspace: { equals: workspace }, name: { equals: name } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as Doc | undefined
  return { name, title: pack.title, usedBy: pack.usedBy, description: pack.description, layout: pack.layout, body: row?.body ?? pack.body, packBody: pack.body, custom: row ? { by: (row.updatedBy as string | null) ?? null, at: row.updatedAt as string } : null }
}

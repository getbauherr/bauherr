import type { CollectionConfig, Field } from 'payload'
import { bauherrOnly } from './access'

export const rel = (name: string, to: string, extra: Partial<Field> = {}): Field =>
  ({ name, type: 'relationship', relationTo: to, ...extra }) as Field
export const text = (name: string, extra: Partial<Field> = {}): Field => ({ name, type: 'text', ...extra }) as Field
export const date = (name: string): Field => ({ name, type: 'date' })
export const json = (name: string): Field => ({ name, type: 'json' })
export const select = (name: string, options: string[], extra: Partial<Field> = {}): Field =>
  ({ name, type: 'select', options, ...extra }) as Field

export const col = (slug: string, fields: Field[], extra: Partial<CollectionConfig> = {}): CollectionConfig => ({
  slug,
  admin: { useAsTitle: (fields[0] as { name: string }).name },
  fields,
  ...extra,
  access: { read: bauherrOnly, create: bauherrOnly, update: bauherrOnly, delete: bauherrOnly, ...extra.access },
})

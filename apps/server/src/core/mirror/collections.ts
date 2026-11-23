import type { CollectionConfig, Field } from 'payload'
import { isBauherr } from '../../lib/people'

const closed = () => false
const readable = ({ req }: { req: { user?: object | null } }): boolean => isBauherr(req.user ?? null)
const access = { read: readable, create: closed, update: closed, delete: closed }

const text = (name: string, required = false): Field => ({ name, type: 'text', required })
const flag = (name: string): Field => ({ name, type: 'checkbox', defaultValue: false })
const date = (name: string): Field => ({ name, type: 'date' })
const list = (name: string): Field => ({ name, type: 'json' })
const relation = (name: string, to: string): Field => ({ name, type: 'relationship', relationTo: to, required: true })

export const mirrorCollections: CollectionConfig[] = [
  {
    slug: 'mirror_items',
    admin: { useAsTitle: 'title' },
    access,
    fields: [
      relation('source', 'ticket_sources'),
      relation('product', 'products'),
      text('repo', true),
      { name: 'number', type: 'number', required: true },
      text('kind', true),
      text('title', true),
      text('body'),
      text('state', true),
      text('author'),
      flag('authorTrusted'),
      flag('authorIsBot'),
      list('labels'),
      list('assignees'),
      text('url'),
      date('forgeCreatedAt'),
      date('forgeUpdatedAt'),
      date('forgeClosedAt'),
      text('headSha'),
      text('headRef'),
      text('baseRef'),
      text('conflictSha'),
      text('mergeCheck'),
      text('mergeSha'),
      list('closes'),
      flag('draft'),
      date('syncedAt'),
      date('goneAt'),
    ],
    indexes: [{ fields: ['workspace', 'repo', 'number'], unique: true }],
  },
  {
    slug: 'mirror_comments',
    admin: { useAsTitle: 'author' },
    access,
    fields: [
      relation('item', 'mirror_items'),
      text('forgeId', true),
      text('author'),
      text('body'),
      date('forgeCreatedAt'),
      date('forgeUpdatedAt'),
    ],
    indexes: [{ fields: ['item', 'forgeId'], unique: true }],
  },
  {
    slug: 'mirror_checks',
    admin: { useAsTitle: 'name' },
    access,
    fields: [
      relation('item', 'mirror_items'),
      text('sha', true),
      text('name', true),
      text('status'),
      text('conclusion'),
      text('url'),
      date('forgeUpdatedAt'),
    ],
    indexes: [{ fields: ['item', 'sha', 'name'], unique: true }],
  },
]

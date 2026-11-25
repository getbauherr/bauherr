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
  {
    slug: 'ticket_relations',
    admin: { useAsTitle: 'type' },
    access,
    fields: [relation('fromItem', 'mirror_items'), relation('toItem', 'mirror_items'), text('type', true)],
    indexes: [{ fields: ['fromItem', 'toItem', 'type'], unique: true }],
  },
  {
    slug: 'repo_instruction_files',
    admin: { useAsTitle: 'path' },
    access,
    fields: [
      relation('product', 'products'),
      text('repo', true),
      text('path', true),
      { name: 'lines', type: 'number', required: true },
      { name: 'chars', type: 'number', required: true },
      text('commit', true),
      { name: 'syncedAt', type: 'date', required: true },
    ],
    indexes: [{ fields: ['workspace', 'product', 'repo', 'path'], unique: true }],
  },
  {
    slug: 'release_notes',
    admin: { useAsTitle: 'version' },
    access,
    fields: [
      relation('product', 'products'),
      text('version', true),
      { name: 'items', type: 'json', required: true },
      { name: 'internalCount', type: 'number', required: true, defaultValue: 0 },
      { name: 'generatedAt', type: 'date', required: true },
    ],
    indexes: [{ fields: ['product', 'version'], unique: true }],
  },
  {
    slug: 'product_releases',
    admin: { useAsTitle: 'version' },
    access,
    fields: [
      relation('product', 'products'),
      text('version', true),
      text('sha', true),
      text('state', true),
      { name: 'steps', type: 'json', required: true },
      text('body'),
      { name: 'tickets', type: 'json', required: true },
      text('forgeRelease'),
      text('failure'),
      date('claimedAt'),
    ],
    indexes: [{ fields: ['version', 'product'], unique: true }],
  },
]

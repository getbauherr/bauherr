import type { CollectionConfig } from 'payload'
import { isBauherr } from '../lib/people'

const closed = () => false
const readable = ({ req }: { req: { user?: object | null } }): boolean => isBauherr(req.user ?? null)

export const coreCollections: CollectionConfig[] = [
  {
    slug: 'records',
    admin: { useAsTitle: 'sourceRepo' },
    access: { read: readable, create: closed, update: closed, delete: closed },
    fields: [
      { name: 'product', type: 'relationship', relationTo: 'products', required: true },
      { name: 'sourceForge', type: 'text', required: true },
      { name: 'sourceRepo', type: 'text', required: true },
      { name: 'sourceNumber', type: 'number', required: true },
      { name: 'stage', type: 'text', required: true },
      { name: 'waitingOn', type: 'text', required: true },
      { name: 'rank', type: 'number', required: true, defaultValue: 0 },
      { name: 'version', type: 'number', required: true, defaultValue: 1 },
      { name: 'card', type: 'json' },
      { name: 'data', type: 'json', required: true },
    ],
    indexes: [{ fields: ['workspace', 'sourceForge', 'sourceRepo', 'sourceNumber'], unique: true }],
  },
  {
    slug: 'events',
    admin: { useAsTitle: 'type' },
    access: { read: readable, create: closed, update: closed, delete: closed },
    fields: [
      { name: 'record', type: 'relationship', relationTo: 'records', required: true, index: true },
      { name: 'type', type: 'text', required: true },
      { name: 'actor', type: 'text', required: true },
      { name: 'actorId', type: 'text' },
      { name: 'data', type: 'json', required: true },
    ],
  },
  {
    slug: 'stage_runs',
    admin: { useAsTitle: 'stage' },
    access: { read: readable, create: closed, update: closed, delete: closed },
    fields: [
      { name: 'record', type: 'relationship', relationTo: 'records', required: true, index: true },
      { name: 'stage', type: 'text', required: true },
      { name: 'role', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'fingerprint', type: 'text', required: true },
      { name: 'attempt', type: 'number', required: true, defaultValue: 0 },
      { name: 'leaseTokenHash', type: 'text' },
      { name: 'leasedBy', type: 'text' },
      { name: 'leaseExpiresAt', type: 'date' },
      { name: 'steps', type: 'json', required: true },
      { name: 'result', type: 'json' },
      { name: 'error', type: 'text' },
      { name: 'costUsd', type: 'number' },
      { name: 'startedAt', type: 'date' },
      { name: 'finishedAt', type: 'date' },
    ],
  },
]

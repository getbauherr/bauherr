import type { CollectionConfig } from 'payload'

/** Nothing outside the app's own routes (overrideAccess + an owner check) reads or writes chat data. */
const closed = { read: () => false, create: () => false, update: () => false, delete: () => false }

/** Factory chat: one thread per conversation, owned by one Bauherr in one Workspace (tenant field added by the multi-tenant plugin). */
export const chatCollections: CollectionConfig[] = [
  {
    slug: 'chat_threads',
    admin: { useAsTitle: 'title' },
    access: closed,
    indexes: [{ fields: ['owner', 'ticket'], unique: true }, { fields: ['owner', 'intakeSession'], unique: true }],
    fields: [
      { name: 'owner', type: 'relationship', relationTo: 'bauherren', required: true, index: true },
      { name: 'title', type: 'text' },
      { name: 'context', type: 'json', admin: { description: 'Page context of the last message: { path, label }.' } },
      { name: 'pending', type: 'json', admin: { description: 'The one tool call awaiting confirmation, with the model state to resume: { toolCallId, name, kind, input, summary, issuedAt, card, state }.' } },
      { name: 'ticket', type: 'relationship', relationTo: 'tickets', index: true, admin: { description: 'Set on the Ticket thread: one per person and Ticket (unique owner + ticket; a plain thread has no Ticket and is not limited).' } },
      { name: 'request', type: 'checkbox', defaultValue: false, admin: { description: 'A request thread: the person describes a new request to the intake interview (its session is `intakeSession`, set once the Product is chosen).' } },
      { name: 'intakeSession', type: 'relationship', relationTo: 'intake_sessions', index: true, admin: { description: 'The request this thread is about: one thread per person and request (unique owner + intakeSession).' } },
      { name: 'archivedAt', type: 'date' },
      { name: 'lastMessageAt', type: 'date', index: true },
    ],
  },
  {
    slug: 'chat_messages',
    admin: { useAsTitle: 'messageId' },
    access: closed,
    fields: [
      { name: 'thread', type: 'relationship', relationTo: 'chat_threads', required: true, index: true },
      { name: 'messageId', type: 'text', required: true },
      { name: 'parentId', type: 'text' },
      { name: 'message', type: 'json', admin: { description: "assistant-ui's exported message item, verbatim; null until the client has stored the answer the server issued." } },
      { name: 'role', type: 'text' },
      { name: 'answer', type: 'json', admin: { description: '{ model, tokensIn, tokensOut, costUsd, ms, toolCalls: [{ name, kind, ok }] }' } },
      { name: 'feedback', type: 'text', admin: { description: "'up' or 'down'" } },
      { name: 'feedbackReasons', type: 'json' },
      { name: 'feedbackNote', type: 'text', maxLength: 2000 },
      { name: 'feedbackAt', type: 'date' },
    ],
    indexes: [{ fields: ['thread', 'messageId'], unique: true }],
  },
]

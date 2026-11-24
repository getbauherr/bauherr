import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
  ThreadMessageLike,
} from '@assistant-ui/react'
import { FILE_MAX_BYTES, FILE_TYPES } from '../../../../core/conversations/limits'
import { fileUrl, type ConversationApi, type ConversationEntry, type ConversationFile } from './conversation-api'

const MB = 1024 * 1024

const attachmentType = (contentType: string): 'image' | 'document' =>
  contentType.startsWith('image/') ? 'image' : 'document'

export const completeAttachment = (conversationId: number, stored: ConversationFile): CompleteAttachment => {
  const url = fileUrl(conversationId, stored.id)
  return {
    id: String(stored.id),
    type: attachmentType(stored.contentType),
    name: stored.name,
    contentType: stored.contentType,
    status: { type: 'complete' },
    content: stored.contentType.startsWith('image/')
      ? [{ type: 'image', image: url }]
      : [{ type: 'file', data: url, mimeType: stored.contentType, filename: stored.name }],
  }
}

export const toThreadMessage = (conversationId: number, entry: ConversationEntry): ThreadMessageLike => ({
  id: String(entry.id),
  role: entry.role,
  createdAt: new Date(entry.createdAt),
  content: [{ type: 'text', text: entry.text }],
  attachments: entry.files.map((file) => completeAttachment(conversationId, file)),
})

export const refusalOf = (file: { size: number; type: string }): string | null => {
  if (file.size > FILE_MAX_BYTES) return `The file is larger than ${FILE_MAX_BYTES / MB} MB: shrink it.`
  if (!FILE_TYPES.includes(file.type)) return 'Only images (PNG, JPEG, WebP), PDF and text files can be attached.'
  return null
}

const refused = (file: File, message: string): PendingAttachment => ({
  id: crypto.randomUUID(),
  type: attachmentType(file.type),
  name: file.name,
  contentType: file.type,
  file,
  status: { type: 'incomplete', reason: 'error', message },
})

export type ConversationAttachments = Omit<AttachmentAdapter, 'add'> & {
  add: (state: { file: File }) => Promise<PendingAttachment>
}

export const attachmentAdapter = (
  conversation: () => Promise<number>,
  api: ConversationApi,
): ConversationAttachments => ({
  accept: FILE_TYPES.join(','),
  add: async ({ file }) => {
    const message = refusalOf(file)
    if (message) return refused(file, message)
    try {
      const stored = await api.upload(await conversation(), file)
      return {
        id: String(stored.id),
        type: attachmentType(stored.contentType),
        name: stored.name,
        contentType: stored.contentType,
        file,
        status: { type: 'requires-action', reason: 'composer-send' },
      }
    } catch (error) {
      return refused(file, error instanceof Error ? error.message : 'The upload failed.')
    }
  },
  send: async (attachment) =>
    completeAttachment(await conversation(), {
      id: Number(attachment.id),
      name: attachment.name,
      contentType: attachment.contentType ?? '',
      bytes: attachment.file.size,
    }),
  remove: () => Promise.resolve(),
})

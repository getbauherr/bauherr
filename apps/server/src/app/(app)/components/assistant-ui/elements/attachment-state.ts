'use client'

import { useAui, useAuiState } from '@assistant-ui/react'
import { useAttachmentSrc } from '@/hooks/use-attachment-src'

const LABELS: Record<string, string> = { image: 'Image', document: 'Document', file: 'File' }

export function useAttachmentState() {
  const aui = useAui()
  const src = useAttachmentSrc()
  const isImage = useAuiState((s) => s.attachment.type === 'image')
  const name = useAuiState((s) => s.attachment.name)
  const typeLabel = useAuiState((s) => LABELS[s.attachment.type] ?? s.attachment.type)
  const isError = useAuiState(
    (s) => s.attachment.status.type === 'incomplete' && s.attachment.status.reason === 'error',
  )
  const isUploading = useAuiState(
    (s) =>
      s.attachment.status.type === 'running' ||
      (s.optional.message?.submission !== undefined && s.attachment.status.type !== 'complete'),
  )
  const errorMessage = useAuiState((s) =>
    s.attachment.status.type === 'incomplete' && s.attachment.status.reason === 'error'
      ? (s.attachment.status.message ?? 'Upload failed')
      : undefined,
  )
  return {
    isComposer: aui.attachment.source !== 'message',
    src,
    isImage,
    name,
    typeLabel,
    isUploading: isUploading && !isError,
    isError,
    errorMessage,
  }
}

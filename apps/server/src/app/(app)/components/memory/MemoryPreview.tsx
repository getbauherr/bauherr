'use client'
import { TextMessagePartProvider } from '@assistant-ui/react'
import { MarkdownText } from '../assistant-ui/elements/markdown-text'

export function MemoryPreview({ body }: { body: string }) {
  return (
    <div className="min-h-[440px] px-6 py-4 text-[14px] leading-[21px]" data-testid="memory-preview">
      <TextMessagePartProvider text={body}>
        <MarkdownText />
      </TextMessagePartProvider>
    </div>
  )
}

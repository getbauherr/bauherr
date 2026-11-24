'use client'
import { useState } from 'react'
import type { AttachmentView } from '../../../../core/views/attachments'
import { sourceOf } from './image-ref'

const WIDTHS = [1280, 390] as const
const BUTTON =
  'w-fit rounded-md border border-border px-3 py-1 text-sm aria-pressed:border-primary aria-pressed:bg-accent'

export function MockupFrame({ mockup }: { mockup: AttachmentView }) {
  const [width, setWidth] = useState<(typeof WIDTHS)[number]>(1280)
  const src = sourceOf(mockup)
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {WIDTHS.map((option) => (
          <button
            key={option}
            type="button"
            className={BUTTON}
            aria-pressed={width === option}
            onClick={() => setWidth(option)}
          >
            {option}
          </button>
        ))}
        <a href={src} target="_blank" rel="noopener noreferrer" className="small ml-auto text-primary hover:underline">
          Open full size
        </a>
      </div>
      <div className="min-w-0 overflow-auto rounded-md border border-border bg-card">
        <iframe
          title={mockup.caption}
          src={src}
          sandbox="allow-scripts"
          style={{ width, height: 560 }}
          className="block max-w-none border-0"
        />
      </div>
      <span className="small text-muted-foreground">{mockup.caption}</span>
    </div>
  )
}

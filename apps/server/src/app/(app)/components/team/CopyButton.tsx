'use client'
import { useState, type ComponentProps } from 'react'
import { Button } from '../ui/button'

/** Copies `text` and says "Copied" for 1.5 s. Outline by default; `primary` is the page's one accent button. */
export function CopyButton({ text, label = 'Copy', primary, onCopy, ...props }: { text: string; label?: string; primary?: boolean; onCopy?: () => void } & Omit<ComponentProps<typeof Button>, 'onClick' | 'variant' | 'size' | 'children'>) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant={primary ? 'default' : 'outline'}
      size={primary ? 'default' : 'sm'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          return
        }
        onCopy?.()
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      aria-live="polite"
      {...props}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

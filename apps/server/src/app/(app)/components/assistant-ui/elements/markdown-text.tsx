'use client'
import '@assistant-ui/react-markdown/styles/dot.css'
import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { memo, useState, type FC } from 'react'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(code ?? '').then(() => setCopied(true))
  }
  return (
    <div
      className={cn(
        'aui-code-header-root mt-3 flex items-center justify-between rounded-t-xl',
        'border border-b-0 border-border/50 bg-muted/50 px-3.5 py-1.5 text-xs',
      )}
    >
      <span className="aui-code-header-language font-medium text-muted-foreground lowercase">{language}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy'}
        className="inline-flex size-6 items-center justify-center rounded-md hover:bg-muted"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  )
}

const components = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1 className={cn('aui-md-h1 mt-5 mb-2 text-xl font-semibold first:mt-0 last:mb-0', className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        'aui-md-h2 mt-5 mb-2 border-b border-border pb-0.5 text-[15px] font-semibold first:mt-0 last:mb-0',
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn('aui-md-h3 mt-4 mb-1.5 text-base font-semibold first:mt-0 last:mb-0', className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn('aui-md-p my-3 leading-relaxed first:mt-0 last:mb-0', className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a className={cn('aui-md-a text-primary underline underline-offset-2', className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        'aui-md-blockquote my-3 border-s-2 border-muted-foreground/30 ps-4 text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn('aui-md-ul my-3 ms-5 list-disc marker:text-muted-foreground [&>li]:mt-1', className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn('aui-md-ol my-3 ms-5 list-decimal marker:text-muted-foreground [&>li]:mt-1', className)}
      {...props}
    />
  ),
  li: ({ className, ...props }) => <li className={cn('aui-md-li leading-relaxed', className)} {...props} />,
  strong: ({ className, ...props }) => <strong className={cn('aui-md-strong font-semibold', className)} {...props} />,
  hr: ({ className, ...props }) => (
    <hr className={cn('aui-md-hr my-3 border-muted-foreground/20', className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        'aui-md-pre overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 border-border/50',
        'bg-muted/30 p-3.5 text-[13px] leading-relaxed',
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock()
    return (
      <code
        className={cn(
          !isCodeBlock && 'aui-md-inline-code rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]',
          className,
        )}
        {...props}
      />
    )
  },
  CodeHeader,
})

export const MarkdownText = memo(function MarkdownText() {
  return <MarkdownTextPrimitive smooth={false} remarkPlugins={[remarkGfm]} className="aui-md" components={components} />
})

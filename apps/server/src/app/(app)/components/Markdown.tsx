import { cn } from '@/lib/utils'

/** Server-rendered markdown (already sanitized by `renderMarkdown`). */
export function Markdown({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(
        'max-w-[80ch] break-words [&>*]:mb-0 [&>*+*]:mt-3 [&>:first-child]:mt-0 [&_a]:text-primary [&_a]:underline [&_blockquote]:ml-0 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded-sm [&_code]:bg-secondary [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-[17px] [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1 [&_th]:text-left [&_ul]:pl-6',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

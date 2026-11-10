'use client'
import { MarkdownTextPrimitive, type CodeHeaderProps, type SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import Link from 'next/link'
import remarkGfm from 'remark-gfm'
import { lazy, Suspense, useState, type ComponentProps, type FC } from 'react'
import { Check, Copy } from './icons'

/** The highlighter (shiki) is its own chunk, fetched when the first fenced code block is shown. */
const Highlight = lazy(() => import('./highlight'))

const Code: FC<SyntaxHighlighterProps> = ({ language, code }) => (
  <div className="aui-shiki overflow-x-auto rounded-b-md border border-t-0 bg-secondary p-3 font-mono text-[13px] leading-5 [&_pre]:m-0 [&_pre]:bg-transparent!">
    <Suspense fallback={<pre>{code}</pre>}>
      <Highlight code={code} language={language} />
    </Suspense>
  </div>
)

const Header: FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 flex items-center justify-between rounded-t-md border bg-secondary px-3 py-1 text-xs text-muted-foreground">
      <span>{language}</span>
      <button
        type="button"
        aria-label="Copy code"
        className="hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  )
}

/** `#123` outside code is a link to the Ticket; the server writes Tickets as `#number`. */
const linkTickets = (text: string): string => text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/).map((s, i) => (i % 2 ? s : s.replace(/(^|[\s(])#(\d{1,6})\b/g, '$1[#$2](/tickets/n/$2)'))).join('')

const A = ({ href = '', children }: ComponentProps<'a'>) =>
  href.startsWith('/') ? (
    <Link href={href} className="text-primary underline underline-offset-2">{children}</Link>
  ) : (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{children}</a>
  )

const components = { SyntaxHighlighter: Code, CodeHeader: Header, a: A }

const prose =
  'break-words text-[14px] leading-6 [&>*+*]:mt-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded-sm [&_code]:bg-secondary [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:mt-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-secondary [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5'

/** Assistant text: GFM, highlighted code, `#123` as Ticket links. */
export const MarkdownText: FC = () => <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} components={components} preprocess={linkTickets} className={prose} />

/** Shiki's dual-theme output follows the app theme (the `data-theme` override, else the OS). */
export const shikiCss = `.aui-shiki span{color:var(--shiki-light)}@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .aui-shiki span{color:var(--shiki-dark)}}:root[data-theme=dark] .aui-shiki span{color:var(--shiki-dark)}`

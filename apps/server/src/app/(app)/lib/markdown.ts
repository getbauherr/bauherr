import { Marked } from 'marked'
import { isWebUrl } from './url'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Raw HTML is escaped, images become their alt text, links keep only http(s) targets. Everything else is marked's own safe output. */
const md = new Marked({
  async: false,
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => esc(text),
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens)
      return isWebUrl(href) ? `<a href="${esc(href)}" rel="noopener noreferrer">${inner}</a>` : inner
    },
  },
})

export const renderMarkdown = (src: string): string => md.parse(src) as string

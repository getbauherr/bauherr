'use client'
import { useEffect, useState, type FC } from 'react'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages } from 'shiki/langs'
import { bundledThemes } from 'shiki/themes'

const LANGS = ['typescript', 'tsx', 'javascript', 'json', 'bash', 'yaml', 'sql', 'diff', 'markdown', 'python', 'php'] as const
const ALIASES: Record<string, (typeof LANGS)[number]> = { ts: 'typescript', js: 'javascript', jsx: 'tsx', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', md: 'markdown', py: 'python' }
const themes = { light: 'github-light', dark: 'github-dark' }

let highlighter: Promise<HighlighterCore> | undefined
const load = () =>
  (highlighter ??= createHighlighterCore({
    themes: [bundledThemes['github-light'], bundledThemes['github-dark']],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }))

/** One fenced block (its grammar is fetched on first use, from the small set in `LANGS`), tokenised with one light and one dark theme (colours switch by CSS variable, see `shikiCss`). Loaded only when a message contains a code block. */
const Highlight: FC<{ code: string; language: string }> = ({ code, language }) => {
  const [html, setHtml] = useState<string | null>(null)
  const lang = LANGS.find((l) => l === language) ?? ALIASES[language]
  useEffect(() => {
    if (!lang) return setHtml(null)
    let live = true
    const id = setTimeout(() => void load().then(async (h) => {
      await h.loadLanguage(bundledLanguages[lang])
      if (live) setHtml(h.codeToHtml(code, { lang, themes, defaultColor: false }))
    }), 120)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [code, lang])
  return html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre>{code}</pre>
}

export default Highlight

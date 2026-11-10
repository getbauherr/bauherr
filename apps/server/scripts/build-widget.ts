import tailwind from '@tailwindcss/postcss'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const widget = new URL('../src/app/intake/widget/', import.meta.url)

/** Bundles the embeddable Intake widget (React, assistant-ui and its CSS inlined) into `outfile`. */
export async function buildWidget(outfile: string): Promise<void> {
  const from = new URL('widget.css', widget).pathname
  const compiled = await postcss([tailwind({ base: widget.pathname })]).process(readFileSync(from, 'utf8'), { from })
  const css = readFileSync(new URL('tokens.css', widget), 'utf8') + compiled.css
  await build({
    entryPoints: [new URL('index.tsx', widget).pathname],
    outfile,
    bundle: true,
    minify: true,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    tsconfig: new URL('../tsconfig.json', import.meta.url).pathname,
    plugins: [{ name: 'widget-css', setup: (b) => {
      b.onResolve({ filter: /^widget:css$/ }, () => ({ path: 'widget-css', namespace: 'widget' }))
      b.onLoad({ filter: /.*/, namespace: 'widget' }, () => ({ contents: css, loader: 'text' }))
    } }],
  })
}

if (process.argv[1] === new URL(import.meta.url).pathname) await buildWidget(new URL('../public/intake/widget.js', import.meta.url).pathname)

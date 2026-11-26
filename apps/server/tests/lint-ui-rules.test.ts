import { ESLint } from 'eslint'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import tseslint from 'typescript-eslint'
import config from '../../../eslint.config.mjs'
import { repoRoot } from './helpers/comments'

const lint = async (relative: string, code: string): Promise<string[]> => {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [...config, tseslint.configs.disableTypeChecked],
    ignorePatterns: [],
    suppressionsLocation: join(repoRoot, 'no-suppressions.json'),
  })
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, relative) })
  return result.messages.map((m) => m.message)
}

const page = 'apps/server/src/app/(app)/(shell)/probe/Probe.tsx'
const rawButton = 'export const Probe = () => <button type="button">Go</button>\n'

test('a raw button in (app) fails lint and names the shadcn component', async () => {
  const messages = await lint(page, rawButton)
  expect(messages.some((m) => m.includes('@/components/ui'))).toBe(true)
})

test.each(['input', 'select', 'textarea', 'dialog', 'table'])('a raw %s in (app) fails lint', async (tag) => {
  const messages = await lint(page, `export const Probe = () => <${tag} />\n`)
  expect(messages.some((m) => m.includes('@/components/ui'))).toBe(true)
})

test('components/ui may use raw elements and Radix', async () => {
  const code = `import * as P from '@radix-ui/react-popover'\n${rawButton}`
  const messages = await lint('apps/server/src/app/(app)/components/ui/probe.tsx', code)
  expect(messages.filter((m) => m.includes('@/components/ui') || m.includes('Radix'))).toEqual([])
})

test('a Radix import outside components/ui fails lint', async () => {
  const messages = await lint(page, `import * as P from '@radix-ui/react-popover'\nexport const Probe = P.Root\n`)
  expect(messages.some((m) => m.includes('Radix'))).toBe(true)
})

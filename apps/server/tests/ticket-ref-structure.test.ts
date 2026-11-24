import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const root = join(__dirname, '..', 'src', 'app')
const ALLOWED = ['TicketRefPopover.tsx']

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.tsx') ? [join(dir, entry.name)] : [],
  )

const TICKET_LINK = /<(?:Link|a)\b[^>]*\/tickets\/[^>]*>\s*\{?[^<]*#\$?\{/

it('no ticket link is built from a # and a number outside the shared ticket reference components', () => {
  const offenders = files(root)
    .filter((file) => !ALLOWED.some((name) => file.endsWith(name)))
    .filter((file) => TICKET_LINK.test(readFileSync(file, 'utf8')))
  expect(offenders).toEqual([])
})

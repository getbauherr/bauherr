import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const serverRoot = join(import.meta.dirname, '..')
const SOURCES = ['shadcn', 'assistant-ui', 'local'] as const
const WATCHED = ['ui', 'assistant-ui/elements']

const lockSchema = z.object({
  root: z.string(),
  files: z.record(
    z.string(),
    z.object({
      registry: z.string().nullable(),
      source: z.enum(SOURCES),
      lookalike: z.boolean().optional(),
    }),
  ),
})

export const registryProblems = (): string[] => {
  const lock = lockSchema.parse(JSON.parse(readFileSync(join(serverRoot, 'registry.lock.json'), 'utf8')))
  const root = join(serverRoot, lock.root)
  const onDisk = WATCHED.flatMap((dir) => readdirSync(join(root, dir)).map((name) => `${dir}/${name}`))
  const unlisted = onDisk
    .filter((file) => !(file in lock.files))
    .map((file) => `${file} is not in registry.lock.json. Install it with shadcn add or assistant-ui add and list it.`)
  const stale = Object.keys(lock.files)
    .filter((file) => !existsSync(join(root, file)))
    .map((file) => `${file} is in registry.lock.json but missing on disk. Remove the entry.`)
  const unsourced = Object.entries(lock.files)
    .filter(([, entry]) => entry.source !== 'local' && entry.registry === null)
    .map(([file]) => `${file} names a registry source but no registry name. Add the registry name.`)
  return [...unlisted, ...stale, ...unsourced]
}

if (process.argv[1] === import.meta.filename) {
  const problems = registryProblems()
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
}

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CliError } from './preflight.js'

const SCRIPT = 'bauherr-report-usage.ts'
const EVENTS = ['Stop', 'SubagentStop'] as const

type Entry = { matcher?: string; hooks?: { type?: string; command?: string }[] }

/** Copies the usage hook next to the Claude Code settings file and merges a `Stop` and a `SubagentStop` entry for it; running it again replaces its own entries and leaves all others alone. */
export const installHook = (o: { project: boolean; cwd?: string; home?: string; source?: URL }): string => {
  const dir = join(o.project ? (o.cwd ?? process.cwd()) : (o.home ?? homedir()), '.claude')
  const file = join(dir, 'settings.json')
  let settings: { hooks?: Record<string, Entry[]> } = {}
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      throw new CliError(`${file} is not valid JSON; fix it and run again`)
    }
  }
  const script = join(dir, SCRIPT)
  mkdirSync(dir, { recursive: true })
  copyFileSync(o.source ?? new URL('../templates/hooks/report-usage.ts', import.meta.url), script)
  const hooks = (settings.hooks ??= {})
  for (const event of EVENTS) {
    const others = (hooks[event] ?? []).filter((e) => !e.hooks?.some((h) => h.command?.includes(SCRIPT)))
    hooks[event] = [...others, { hooks: [{ type: 'command', command: `node ${script}` }] }]
  }
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
  return file
}

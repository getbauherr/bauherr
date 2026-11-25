import { isVersion, sortVersions } from '../readiness/release-facts'

export type Bump = 'major' | 'minor' | 'patch'
export type ChangeFacts = { bug: boolean; tags: string[] }

const PARTS = /^(v?)(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

type Parts = { prefix: string; major: number; minor: number; patch: number; pre: boolean }

const partsOf = (name: string): Parts | null => {
  const found = PARTS.exec(name)
  if (!found) return null
  const [, prefix = '', major = '0', minor = '0', patch = '0', pre] = found
  return { prefix, major: Number(major), minor: Number(minor), patch: Number(patch), pre: pre !== undefined }
}

const text = (parts: Parts): string => `${parts.prefix}${parts.major}.${parts.minor}.${parts.patch}`

export const bumpOf = (tickets: ChangeFacts[]): Bump => {
  if (tickets.some((ticket) => ticket.tags.includes('behaviour'))) return 'major'
  if (tickets.some((ticket) => !ticket.bug && ticket.tags.includes('visible'))) return 'minor'
  return 'patch'
}

const raised = (from: Parts, bump: Bump): Parts => {
  if (from.pre) return from
  if (bump === 'major' && from.major > 0) return { ...from, major: from.major + 1, minor: 0, patch: 0 }
  if (bump !== 'patch') return { ...from, minor: from.minor + 1, patch: 0 }
  return { ...from, patch: from.patch + 1 }
}

const key = (name: string): string => name.replace(/^v/, '')

export const nextVersion = (existing: string[], bump: Bump): string | null => {
  const last = sortVersions(existing)[0]
  const parts = last === undefined ? null : partsOf(last)
  if (parts === null) return null
  const taken = new Set(existing.filter(isVersion).map(key))
  let candidate = raised(parts, bump)
  while (taken.has(key(text(candidate)))) candidate = { ...candidate, patch: candidate.patch + 1 }
  return text(candidate)
}

export const validVersion = (name: string, existing: string[]): boolean =>
  isVersion(name) && !name.includes('-') && !existing.some((tag) => key(tag) === key(name))

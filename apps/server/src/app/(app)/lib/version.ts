import { statSync } from 'node:fs'
import path from 'node:path'

const stamp = (iso?: string): string | undefined => {
  const t = iso ? new Date(iso) : undefined
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 16).replace('T', ' ') : undefined
}

let builtAtFile: string | undefined | null = null

const buildFileTime = (): string | undefined => {
  if (process.env.NODE_ENV !== 'production') return undefined
  if (builtAtFile === null) {
    try {
      builtAtFile = statSync(path.resolve(process.cwd(), '.next/BUILD_ID')).mtime.toISOString()
    } catch {
      builtAtFile = undefined
    }
  }
  return builtAtFile
}

export const appVersion = (): string => {
  const version = process.env.BAUHERR_VERSION
  const built = stamp(process.env.BAUHERR_BUILD_DATE) ?? stamp(buildFileTime())
  if (version && version !== 'dev') return [`v${version}`, built?.slice(0, 10)].filter(Boolean).join(' · ')
  const revision = process.env.BAUHERR_REVISION?.slice(0, 7)
  if (built) return ['dev', `${built} UTC`, revision].filter(Boolean).join(' · ')
  return revision ? `dev+${revision}` : 'dev'
}

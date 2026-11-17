import { parse } from 'yaml'
import { matches, WILD } from './glob'

export const STATUSES = ['live', 'hard-to-find', 'no-ui', 'in-progress'] as const

export interface Feature {
  id: string
  area: string
  title: string
  summary: string
  status: (typeof STATUSES)[number]
  page: string | null
  pages?: string[]
  reach: string
  mcp: string[]
  source: string[]
  tests: string[]
  drive: string | null
  proof: string | null
  gotchas: string[]
  guards: string[]
  debt: string[]
}

export interface FeatureMap {
  intro: string
  legend: string
  notes: Record<string, string>
  features: Feature[]
}

export const parseMap = (text: string): FeatureMap => parse(text) as FeatureMap

const covers = (source: string, path: string): boolean => path === source || path.startsWith(source.endsWith('/') ? source : `${source}/`) || (WILD.test(source) && matches(source, path))

export const areaOf = (features: Feature[], paths: string[]): string | null => {
  const hits = new Map<string, number>()
  for (const p of paths) for (const area of new Set(features.filter((f) => f.source?.some((s) => covers(s, p))).map((f) => f.area))) hits.set(area, (hits.get(area) ?? 0) + 1)
  return [...hits].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

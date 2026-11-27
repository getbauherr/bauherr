import { createHash } from 'node:crypto'
import { z } from 'zod'

export const MAX_ALERTS = 20
export const SEVERITIES = ['critical', 'high', 'normal'] as const
export type Severity = (typeof SEVERITIES)[number]
export type Alert = {
  title: string
  description: string
  severity: Severity
  fingerprint: string
  url: string | null
  resolved: boolean
}

const labels = z.record(z.string(), z.string()).default({})
const generic = z.object({
  title: z.string().trim().min(1),
  description: z.string().default(''),
  severity: z.string().default(''),
  fingerprint: z.string().trim().min(1),
  url: z.string().optional(),
  status: z.string().optional(),
})
const grouped = z.object({
  alerts: z
    .array(
      z.object({
        status: z.string().optional(),
        labels,
        annotations: labels,
        fingerprint: z.string().optional(),
        generatorURL: z.string().optional(),
        panelURL: z.string().optional(),
      }),
    )
    .min(1),
})

const SEVERITY_WORDS: Record<string, Severity> = {
  critical: 'critical',
  page: 'critical',
  fatal: 'critical',
  high: 'high',
  error: 'high',
}

export const severityOf = (word: string): Severity => SEVERITY_WORDS[word.trim().toLowerCase()] ?? 'normal'

export const fingerprintHash = (fingerprint: string): string =>
  createHash('sha256').update(fingerprint).digest('hex')

const linkOf = (value: string | undefined): string | null => {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const labelFingerprint = (values: Record<string, string>): string =>
  JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))

const fromGroup = (body: z.output<typeof grouped>): Alert[] =>
  body.alerts.slice(0, MAX_ALERTS).map((alert) => ({
    title: (alert.annotations.summary ?? alert.labels.alertname ?? 'Production alert').slice(0, 200),
    description: (alert.annotations.description ?? '').slice(0, 2000),
    severity: severityOf(alert.labels.severity ?? ''),
    fingerprint: alert.fingerprint?.trim() || labelFingerprint(alert.labels),
    url: linkOf(alert.generatorURL ?? alert.panelURL),
    resolved: alert.status === 'resolved',
  }))

const fromGeneric = (body: z.output<typeof generic>): Alert[] => [
  {
    title: body.title.slice(0, 200),
    description: body.description.slice(0, 2000),
    severity: severityOf(body.severity),
    fingerprint: body.fingerprint,
    url: linkOf(body.url),
    resolved: body.status === 'resolved',
  },
]

export const parseAlerts = (body: unknown): Alert[] | null => {
  const group = grouped.safeParse(body)
  if (group.success) return fromGroup(group.data)
  const one = generic.safeParse(body)
  return one.success ? fromGeneric(one.data) : null
}

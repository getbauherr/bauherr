import { artifactWaivers, ARTIFACT_KINDS, type ArtifactKind, type ReviewChecks } from '@bauherr/runner'
import type { Payload, Where } from 'payload'
import { mediaBytes, MediaRejected, saveMedia, sniff } from './intake/media'
import { forgeOf, id, isFactoryPr } from './release'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

/** Size limits per kind (bytes): images 5 MB, recordings 25 MB, text 200 KB. */
export const ARTIFACT_LIMITS = { image: 5 * 1024 * 1024, recording: 25 * 1024 * 1024, text: 200 * 1024 } as const
export const TEXT_KINDS: readonly ArtifactKind[] = ['transcript', 'sample', 'report']

/** What an agent or the Runner hands in: exactly one of `url` (preview), `text` or `file` (base64) matching the kind. */
export type ProofInput = { kind: ArtifactKind; title: string; criterion?: string; rule?: string; pair?: 'before' | 'after'; url?: string; text?: string; file?: { name?: string; base64: string } }

export class ArtifactRejected extends Error {}

const startsWith = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

/** The recording type by magic bytes (webm: EBML header, mp4: `ftyp` box); the claimed type and the file name are never trusted. */
export const sniffRecording = (b: Uint8Array): 'video/webm' | 'video/mp4' | null =>
  b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 ? 'video/webm' : startsWith(b, 4, 'ftyp') ? 'video/mp4' : null

/** The bytes as UTF-8 text, or null when they are binary or not valid UTF-8. */
export const asText = (b: Uint8Array): string | null => {
  if (b.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    return null
  }
}

/** The URL when it is http(s) and short, else null. */
export const webUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 2048) return null
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol) ? v : null
  } catch {
    return null
  }
}

const bytesOf = (b64: unknown): Uint8Array => {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new ArtifactRejected('file.base64 must be base64')
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/** Checks one proof against its kind (by content) and returns the row data without ticket, run and sha. */
export const checkProof = async (payload: Payload, workspace: number | string, product: number | string, p: ProofInput): Promise<Partial<Doc>> => {
  if (!(ARTIFACT_KINDS as readonly unknown[]).includes(p.kind)) throw new ArtifactRejected(`kind must be ${ARTIFACT_KINDS.join('|')}`)
  const title = typeof p.title === 'string' ? p.title.trim().slice(0, 200) : ''
  if (!title) throw new ArtifactRejected('title is required')
  if (p.pair !== undefined && (p.kind !== 'image' || !['before', 'after'].includes(p.pair))) throw new ArtifactRejected('pair (before|after) is for images only')
  const base = { kind: p.kind, title, criterion: p.criterion?.trim().slice(0, 500) || undefined, rule: p.rule?.trim().slice(0, 60) || undefined, pair: p.pair }
  const given = [p.url, p.text, p.file].filter((v) => v !== undefined).length
  if (given !== 1) throw new ArtifactRejected(`give exactly one of ${p.kind === 'preview' ? 'url' : TEXT_KINDS.includes(p.kind) ? 'text or file' : 'file'}`)
  if (p.kind === 'preview') {
    const url = webUrl(p.url)
    if (!url) throw new ArtifactRejected('url must be an http(s) address')
    return { ...base, url }
  }
  if (TEXT_KINDS.includes(p.kind)) {
    const text = p.text ?? (p.file ? asText(bytesOf(p.file.base64)) : undefined)
    if (text == null) throw new ArtifactRejected('a transcript, sample or report is UTF-8 text')
    if (Buffer.byteLength(text) > ARTIFACT_LIMITS.text) throw new ArtifactRejected('text larger than 200 KB')
    return { ...base, text }
  }
  if (!p.file) throw new ArtifactRejected(`${p.kind} needs a file`)
  const bytes = bytesOf(p.file.base64)
  const name = p.file.name ?? p.title
  if (p.kind === 'image') {
    if (bytes.length > ARTIFACT_LIMITS.image) throw new ArtifactRejected('image larger than 5 MB')
    try {
      const media = await saveMedia(payload, { bytes, name, workspace, product })
      return { ...base, media: media.id }
    } catch (e) {
      if (e instanceof MediaRejected) throw new ArtifactRejected(e.message)
      throw e
    }
  }
  if (bytes.length > ARTIFACT_LIMITS.recording) throw new ArtifactRejected('recording larger than 25 MB')
  const mime = sniffRecording(bytes)
  if (!mime) throw new ArtifactRejected('a recording is webm or mp4')
  const safe = name.replace(/[^\w.-]+/g, '_').slice(-80) || 'recording'
  const media = await payload.create({ collection: 'media', data: { name: safe, mime, workspace, product }, file: { data: Buffer.from(bytes), name: safe, mimetype: mime, size: bytes.length }, overrideAccess: true })
  return { ...base, media: media.id }
}

/** The open factory MR's head commit of the Ticket; throws when there is none (push first). */
export const headShaOf = async (payload: Payload, t: Doc): Promise<string> => {
  const { backend, repo } = await forgeOf(payload, id(t.product))
  const pr = (await backend.forge.listPullRequests(repo, 'open')).find((p) => isFactoryPr(p, repo, t.number))
  if (!pr?.headSha) throw new ArtifactRejected('no open factory MR with a pushed head: push your change first')
  return pr.headSha
}

/** Stores one proof of a Ticket on `sha`; idempotent per (run, rule or title, pair, sha): the same call again returns the first row. */
export const attachProof = async (payload: Payload, t: Doc, a: { run?: number | string; sha: string; item: ProofInput }): Promise<{ id: number | string; created: boolean }> => {
  const key: Where = a.item.rule?.trim() ? { rule: { equals: a.item.rule.trim().slice(0, 60) } } : { title: { equals: String(a.item.title ?? '').trim().slice(0, 200) } }
  const same = await payload.find({ collection: 'artifacts', where: { and: [{ ticket: { equals: t.id } }, { sha: { equals: a.sha } }, { run: a.run ? { equals: a.run } : { exists: false } }, { pair: a.item.pair ? { equals: a.item.pair } : { exists: false } }, { waived: { not_equals: true } }, key] }, limit: 1, ...o })
  if (same.docs[0]) return { id: same.docs[0].id, created: false }
  const data = await checkProof(payload, id(t.workspace), id(t.product), a.item)
  const row = await payload.create({ collection: 'artifacts', data: { ...data, ticket: t.id, run: a.run, sha: a.sha, workspace: id(t.workspace) } as never, ...o })
  return { id: row.id, created: true }
}

/** Names of the rules that have proof (not a waiver) of this Ticket on `sha`. */
export const ruleNamesWithProof = async (payload: Payload, ticket: number | string, sha: string): Promise<string[]> =>
  [...new Set((await payload.find({ collection: 'artifacts', where: { and: [{ ticket: { equals: ticket } }, { sha: { equals: sha } }, { waived: { not_equals: true } }, { rule: { exists: true } }] }, pagination: false, select: { rule: true }, ...o })).docs.flatMap((d) => (d.rule ? [d.rule as string] : [])))]

/** Stores the `No artifact: <rule>: <reason>` Evidence lines for the rules of the Product, once per (rule, sha), so the human sees "No proof for <rule>: <reason>". */
export const recordWaivers = async (payload: Payload, t: Doc, a: { run?: number | string; sha: string; evidence: string; config: ReviewChecks | null | undefined }): Promise<void> => {
  const names = new Set((a.config?.artifacts ?? []).map((r) => r.name))
  for (const [rule, reason] of artifactWaivers(a.evidence)) {
    if (!names.has(rule)) continue
    const have = await payload.count({ collection: 'artifacts', where: { and: [{ ticket: { equals: t.id } }, { sha: { equals: a.sha } }, { rule: { equals: rule } }, { waived: { equals: true } }] }, overrideAccess: true })
    if (!have.totalDocs) await payload.create({ collection: 'artifacts', data: { ticket: t.id, run: a.run, workspace: id(t.workspace), kind: 'report', title: `No proof for ${rule}`, rule, text: reason.slice(0, 500), sha: a.sha, waived: true } as never, ...o })
  }
}

/** Stores what the Runner collected for a Build Run (proof with file bytes) and the waivers of its Evidence; one bad item is skipped and logged, never fails the Run. */
export const ingestProof = async (payload: Payload, t: Doc, a: { run: number | string; sha: string; items: ProofInput[]; evidence?: string; config: ReviewChecks | null | undefined }): Promise<void> => {
  for (const item of a.items) {
    try {
      await attachProof(payload, t, { run: a.run, sha: a.sha, item })
    } catch (e) {
      payload.logger.warn({ err: e, ticket: t.id, run: a.run }, 'proof skipped')
    }
  }
  if (a.evidence) await recordWaivers(payload, t, { run: a.run, sha: a.sha, evidence: a.evidence, config: a.config })
}

/** The stored bytes of an artifact's file with the content type to serve. */
export const artifactFile = async (payload: Payload, a: Doc): Promise<{ bytes: Uint8Array; type: string } | null> => {
  if (!a.media) return null
  const m = (await payload.findByID({ collection: 'media', id: id(a.media), ...o }).catch(() => null)) as Doc | null
  if (!m) return null
  const bytes = await mediaBytes(payload, m)
  const type = sniff(bytes) ?? sniffRecording(bytes)
  return type ? { bytes, type } : null
}

/** The proof of a Ticket on its newest commit as markdown for a forge Comment: titles only (images would need public links), a link to the Ticket page in the factory (sign-in required), and waived rules; undefined when there is none. */
export const proofMarkdown = async (payload: Payload, t: Doc, pageUrl: string): Promise<string | undefined> => {
  const docs = (await payload.find({ collection: 'artifacts', where: { ticket: { equals: t.id } }, sort: '-createdAt', pagination: false, select: { title: true, kind: true, sha: true, waived: true, rule: true, text: true, criterion: true }, ...o })).docs as Doc[]
  const mine = docs.filter((d) => d.sha === docs[0]?.sha).reverse()
  if (!mine.length) return undefined
  return [
    ...mine.map((d) => (d.waived ? `- No proof for ${d.rule}: ${d.text}` : `- ${d.title} (${d.kind}${d.criterion ? `, for: ${d.criterion}` : ''})`)),
    '',
    `See it on the [Ticket page](${pageUrl}) (sign in to the factory).`,
  ].join('\n')
}

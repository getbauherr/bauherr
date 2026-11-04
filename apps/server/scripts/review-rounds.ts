/** Mean and median `reviewRounds` of merged Tickets, before and after a cutoff date: `tsx scripts/review-rounds.ts --since 2026-11-05`. Merged = has a `mergeSha`; dated by `releaseAt`. */
export type RoundRow = { reviewRounds: number | null; releaseAt: string | null }

const stats = (rows: RoundRow[]) => {
  const n = rows.map((r) => r.reviewRounds ?? 0).sort((a, b) => a - b)
  const mid = n.length >> 1
  return { tickets: n.length, rounds: n.reduce((a, b) => a + b, 0), mean: n.length ? +(n.reduce((a, b) => a + b, 0) / n.length).toFixed(2) : null, median: n.length ? (n.length % 2 ? n[mid]! : (n[mid - 1]! + n[mid]!) / 2) : null }
}

export const reviewRoundStats = (rows: RoundRow[], since: string) => {
  const cut = Date.parse(since)
  const dated = rows.filter((r) => r.releaseAt)
  return { before: stats(dated.filter((r) => Date.parse(r.releaseAt!) < cut)), after: stats(dated.filter((r) => Date.parse(r.releaseAt!) >= cut)) }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const since = process.argv[process.argv.indexOf('--since') + 1]
  if (!since || Number.isNaN(Date.parse(since))) throw new Error('usage: review-rounds.ts --since <date>')
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { docs } = await payload.find({ collection: 'tickets', where: { mergeSha: { exists: true } }, pagination: false, depth: 0, overrideAccess: true, select: { reviewRounds: true, releaseAt: true } } as never)
  console.log(JSON.stringify({ since, ...reviewRoundStats(docs as unknown as RoundRow[], since) }, null, 2))
  await payload.destroy()
}

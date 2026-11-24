import type { Forge } from '@bauherr/adapters'

export type Range = { from: Date; to: Date }
export type RangeInput = { from: Date; to: Date } | { since: Date } | { tag: string } | { lastRelease: true }
export type TagForge = Pick<Forge, 'listTags' | 'releaseByTag'>

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

const identifierOrder = (a: string, b: string): number => {
  const numbers = /^\d+$/.test(a) && /^\d+$/.test(b)
  if (numbers) return Number(a) - Number(b)
  return a < b ? -1 : a > b ? 1 : 0
}

const preOrder = (a: string | undefined, b: string | undefined): number => {
  if (a === b) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  const left = a.split('.')
  const right = b.split('.')
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = identifierOrder(left[i] ?? '', right[i] ?? '')
    if (order !== 0) return order
  }
  return left.length - right.length
}

export const compareVersions = (a: string, b: string): number => {
  const left = VERSION.exec(a)
  const right = VERSION.exec(b)
  if (!left || !right) throw new Error(`not a version tag: ${left ? b : a}`)
  for (const part of [1, 2, 3]) {
    const order = Number(left[part]) - Number(right[part])
    if (order !== 0) return order
  }
  return preOrder(left[4], right[4])
}

export const highestVersionTag = (tags: string[]): string | null => {
  const versions = tags.filter((tag) => VERSION.test(tag))
  return versions.length === 0 ? null : versions.reduce((best, tag) => (compareVersions(tag, best) > 0 ? tag : best))
}

export const previousRange = (range: Range): Range => {
  const length = range.to.getTime() - range.from.getTime()
  return { from: new Date(range.from.getTime() - length), to: range.from }
}

const tagDate = async (forge: TagForge, repo: string, tag: string): Promise<Date> => {
  const created = (await forge.releaseByTag(repo, tag))?.createdAt
  if (!created) throw new Error(`no release date for tag ${tag}`)
  return new Date(created)
}

const checked = (range: Range): Range => {
  if (!(range.from.getTime() < range.to.getTime())) throw new Error('a range must start before it ends')
  return range
}

export const resolveRange = async (
  input: RangeInput,
  context: { now: Date; repo: string; forge: TagForge },
): Promise<Range> => {
  if ('from' in input) return checked(input)
  if ('since' in input) return checked({ from: input.since, to: context.now })
  const tag = 'tag' in input ? input.tag : highestVersionTag(await context.forge.listTags(context.repo))
  if (tag === null) throw new Error('no version tag found')
  return checked({ from: await tagDate(context.forge, context.repo, tag), to: context.now })
}

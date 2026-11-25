import { readerFor } from '../../../core/forge/reader'
import { loadProductRow } from '../../../core/forge/write-store'
import { compareVersions, type Range } from '../../../core/insights/range'
import { rangeOf } from '../../../core/retro/converse'
import { rangePreview } from '../../../core/retro/opening'
import { retrosOfProduct, type Retro } from '../../../core/retro/store'
import { memoryProducts } from '../../../core/views/memory-products'
import { connectionInput } from '../../../lib/connection'
import { rangeFromParams } from './retro-range'
import type { Held } from './retro-wiring'

export type StartData = {
  products: { id: number; name: string }[]
  product: { id: number; name: string }
  last: Retro | undefined
  tags: string[]
  since: string | undefined
  range: Range | null
  preview: { accepted: number; runs: number; questions: number } | null
}

const TAGS_SHOWN = 6
const RELEASE = /^v?\d+\.\d+\.\d+/

const tagsOf = async ({ payload, who }: Held, product: number): Promise<string[]> => {
  try {
    const row = await loadProductRow(payload, { workspace: who.workspace, product })
    const forge = readerFor(await connectionInput(payload, row.connection)).forge
    const tags = (await forge.listTags(row.repo)).filter((tag) => RELEASE.test(tag))
    return tags.sort((a, b) => compareVersions(b, a)).slice(0, TAGS_SHOWN)
  } catch {
    return []
  }
}

export const startData = async (
  context: Held,
  params: Record<string, string | undefined>,
): Promise<StartData | null> => {
  const { payload, who } = context
  const products = (await memoryProducts(payload, who.workspace)).filter((product) => product.repo)
  const product = products.find((candidate) => String(candidate.id) === params.product) ?? products[0]
  if (!product) return null
  const last = (await retrosOfProduct(payload, who.workspace, product.id))[0]
  const tags = await tagsOf(context, product.id)
  const since = last?.to.toISOString().slice(0, 10)
  const choice = rangeFromParams({ ...params, range: params.range ?? 'last', tag: params.tag ?? tags[0], since })
  const input = choice ? { product: product.id, ...choice } : null
  const range = input ? await rangeOf(payload, who, input, new Date()).catch(() => null) : null
  const preview = range ? await rangePreview(payload, { workspace: who.workspace, product: product.id, range }) : null
  return { products, product, last, tags, since, range, preview }
}

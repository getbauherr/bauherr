import { stageLabel } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { exclusive, typeLabel, upsertTicket } from './actions'
import { workflowFor } from './factory'
import { read } from './knowledge'
import { forgeOf, id } from './release'
import { nameOf } from './workflow'

type Doc = Record<string, any>

export const VERIFY_CREATE_LABEL = 'bauherr:verify-create'

const openTicket = async (payload: Payload, product: number | string): Promise<Doc | undefined> =>
  (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product } }, { labels: { equals: VERIFY_CREATE_LABEL } }, { state: { equals: 'open' } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0]

export const hasVerifySkill = async (payload: Payload, workspace: number | string, slug: string): Promise<boolean> =>
  !!(await read(payload, workspace, `skills/verify-${slug}/SKILL.md`, slug))

export const verifyCreateBody = (name: string, slug: string): string =>
  [
    `Generate the verification for ${name}. Work as the AX role (\`ax\`) with the pack skill \`verify-create\`.`,
    `## Acceptance criteria\n- [ ] \`verify-${slug}\` is written into the Knowledge repo and was run once end to end.\n- [ ] \`feature-map.yaml\` has the top 3 to 5 features of ${name}.\n- [ ] The evidence of the run is recorded.`,
    'Change no Product code.',
  ].join('\n\n')

export const startVerifyCreate = async (payload: Payload, productId: number | string): Promise<{ ticket: Doc; created: boolean }> =>
  exclusive(`verify-create:${productId}`, async () => {
    const existing = await openTicket(payload, productId)
    if (existing) return { ticket: existing, created: false }
    const product = (await payload.findByID({ collection: 'products', id: productId, depth: 0, overrideAccess: true })) as Doc
    const plan = nameOf(workflowFor(product.workspace), 'plan')
    const { tickets } = await forgeOf(payload, productId)
    const issue = await tickets.create({ title: `Generate verification for ${product.name}`, body: verifyCreateBody(product.name, product.slug), labels: [VERIFY_CREATE_LABEL, typeLabel('change'), stageLabel(plan)] })
    const ticket = await upsertTicket(payload, { workspace: id(product.workspace), product: product.id, externalId: issue.id, number: issue.number, url: issue.url, title: issue.title, state: 'open', labels: issue.labels, stage: plan }, null)
    return { ticket, created: true }
  })

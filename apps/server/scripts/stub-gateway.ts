import { startStubGateway } from '../../../packages/runner/test/helpers'

/** Answers every Messages request with one text reply; no LLM. Usage: tsx scripts/stub-gateway.ts [port]. */
const gw = await startStubGateway('Plan: 1. Read the ticket. 2. Post this plan as a comment.', Number(process.argv[2] ?? 0))
console.log(gw.url)

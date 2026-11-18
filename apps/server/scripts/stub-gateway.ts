import { startStubGateway } from '../../../packages/runner/test/helpers'

const gw = await startStubGateway('Plan: 1. Read the ticket. 2. Post this plan as a comment.', Number(process.argv[2] ?? 0))
console.log(gw.url)

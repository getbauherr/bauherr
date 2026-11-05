/** The admin this worker signs in as. Payload's login rewrites the user's whole `sessions` array, so two workers logging in as one user can lose each other's session: every worker has a user of its own (`seed-e2e.ts`), worker 0 is `E2E_EMAIL`. */
const base = process.env.E2E_EMAIL ?? ''
const index = Number(process.env.TEST_PARALLEL_INDEX ?? 0)
export const email = index > 0 && base ? base.replace('@', `-w${index}@`) : base

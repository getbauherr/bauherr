const base = process.env.E2E_EMAIL ?? ''
const index = Number(process.env.TEST_PARALLEL_INDEX ?? 0)
export const email = index > 0 && base ? base.replace('@', `-w${index}@`) : base

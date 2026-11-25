export const POOL_SIZE = 3

export const pooled = async (make: (n: number) => Promise<number>): Promise<number[]> => {
  const ids: number[] = []
  for (let n = 1; n <= POOL_SIZE; n++) ids.push(await make(n))
  return ids
}

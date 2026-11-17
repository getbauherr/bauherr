export const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => AbortSignal.timeout(ms).addEventListener('abort', () => reject(new Error('forge timeout'))))])

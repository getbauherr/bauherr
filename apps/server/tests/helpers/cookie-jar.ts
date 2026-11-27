export const jar = new Map<string, string>()

export const cookiesMock = async () => ({
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  set: (name: string, value: string) => void jar.set(name, value),
  delete: (name: string) => void jar.delete(name),
})

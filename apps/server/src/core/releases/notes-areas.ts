export const AREAS = [
  { name: 'Memory', emoji: '🔖', words: ['memory', 'retro', 'document', 'skill'] },
  { name: 'Tickets', emoji: '🎫', words: ['ticket', 'plan', 'result', 'card', 'picture', 'mockup', 'proof'] },
  { name: 'Products', emoji: '📦', words: ['product', 'repository', 'readiness', 'connection'] },
  { name: 'Releases', emoji: '🚀', words: ['release', 'version', 'staging', 'production'] },
  { name: 'Requests', emoji: '💬', words: ['request', 'comment', 'conversation', 'chat'] },
  { name: 'Settings', emoji: '⚙️', words: ['setting', 'workspace', 'account', 'sign-in', 'login', 'model'] },
  { name: 'Factory', emoji: '🏭', words: [] },
] as const

export type AreaName = (typeof AREAS)[number]['name']
export const AREA_NAMES: readonly string[] = AREAS.map((area) => area.name)
export const isArea = (name: string): name is AreaName => AREA_NAMES.includes(name)

export const emojiOf = (name: AreaName): string => AREAS.find((area) => area.name === name)?.emoji ?? '🏭'

export const areaOf = (...texts: string[]): AreaName => {
  const haystack = texts.join(' ').toLowerCase()
  const found = AREAS.find((area) => area.words.some((word) => haystack.includes(word)))
  return found?.name ?? 'Factory'
}

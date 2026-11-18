export const forOwner = (body: string): string | null =>
  body.startsWith('<!-- bauherr:') || body.startsWith('Bauherr needs a human:') ? null : body.replace(/\]\([^)\s]*\/m\/(\d+)\/[\w.-]+\)/g, (_m, id: string) => `](/intake/api/media/${id})`)

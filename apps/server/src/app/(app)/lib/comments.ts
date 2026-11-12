/** A comment as a Product owner reads it, or null when it is the factory's own (markers, escalations): images posted for the forge (`/m/<id>/<sig>`) are shown through the signed-in route. */
export const forOwner = (body: string): string | null =>
  body.startsWith('<!-- bauherr:') || body.startsWith('Bauherr needs a human:') ? null : body.replace(/\]\([^)\s]*\/m\/(\d+)\/[\w.-]+\)/g, (_m, id: string) => `](/intake/api/media/${id})`)

export type ImageRef = { id: number; caption: string }

export const sourceOf = (image: ImageRef): string => `/api/attachments/${image.id}`

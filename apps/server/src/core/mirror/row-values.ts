import { z } from 'zod'

export const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())
export const instant = z.coerce.date().nullable()
export const count = z.coerce.number()

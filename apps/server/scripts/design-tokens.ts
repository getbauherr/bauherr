import { z } from 'zod'

const token = z.object({
  name: z.string(),
  value: z.union([z.string(), z.object({ light: z.string(), dark: z.string() })]),
})

const style = z.object({
  name: z.string(),
  fontSize: z.string(),
  lineHeight: z.string(),
  fontWeight: z.number(),
  letterSpacing: z.string().optional(),
})

const tokensSchema = z.object({
  color: z.object({ tokens: z.array(token) }),
  type: z.object({
    families: z.record(z.string(), z.string()),
    groups: z.array(z.object({ family: z.string(), styles: z.array(style) })),
  }),
  spacing: z.object({ tokens: z.array(token) }),
  radius: z.object({ tokens: z.array(token) }),
  duration: z.object({ tokens: z.array(token) }),
  easing: z.object({ tokens: z.array(token) }),
})

export type Tok = z.infer<typeof token>
export type Style = z.infer<typeof style>
export type Tokens = z.infer<typeof tokensSchema>

export const parseTokens = (json: string): Tokens => tokensSchema.parse(JSON.parse(json))

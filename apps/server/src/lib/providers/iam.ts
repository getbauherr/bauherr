import { z } from 'zod'

const iamSecretSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  sessionToken: z.string().nullish(),
})

export type IamSecret = { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

export const parseIamSecret = (secret: string): IamSecret | null => {
  try {
    const parsed = iamSecretSchema.safeParse(JSON.parse(secret))
    if (!parsed.success) return null
    const { accessKeyId, secretAccessKey, sessionToken } = parsed.data
    return { accessKeyId, secretAccessKey, ...(sessionToken != null && { sessionToken }) }
  } catch {
    return null
  }
}

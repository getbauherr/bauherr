import { encrypt, isEncrypted } from '../lib/secrets'

export const seal = (value: unknown): unknown =>
  typeof value === 'string' && value && !isEncrypted(value) ? encrypt(value) : value

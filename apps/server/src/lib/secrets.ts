import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** Resolves `NAME_FILE` (compose secret) before `NAME` (env). */
export const secret = (name: string): string => {
  const file = process.env[`${name}_FILE`]
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[name]
  if (!value) throw new Error(`missing secret ${name}`)
  return value
}

const key = () => createHash('sha256').update(secret('ENCRYPTION_KEY')).digest()
const PREFIX = 'enc:v1:'

export const encrypt = (plain: string): string => {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
}

export const decrypt = (stored: string): string => {
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64')
  const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

export const isEncrypted = (v: string) => v.startsWith(PREFIX)

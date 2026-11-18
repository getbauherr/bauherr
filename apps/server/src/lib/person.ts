export const personOf = (user: Record<string, any>): string => {
  if (typeof user.email !== 'string' || !user.email) throw new Error('a human touch needs a named person')
  return user.email
}

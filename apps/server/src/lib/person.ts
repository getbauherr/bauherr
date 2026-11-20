export const personOf = (user: { email?: unknown }): string => {
  if (typeof user.email !== 'string' || !user.email) throw new Error('a human touch needs a named person')
  return user.email
}

import type { Bauherr } from './session'

export const isAdmin = (u: Bauherr) => u.role === 'admin'
export const only = (u: Bauherr) => {
  if (!isAdmin(u)) throw new Error('Only an Admin can change this.')
}

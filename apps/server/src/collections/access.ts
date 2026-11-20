import { isBauherr } from '../lib/people'

type Requester = { req: { user?: object | null } }

export const isAdmin = ({ req }: Requester): boolean => (req.user as { role?: string } | null)?.role === 'admin'
export const bauherrOnly = ({ req }: Requester): boolean => isBauherr(req.user)

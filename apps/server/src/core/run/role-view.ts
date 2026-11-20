import type { Role } from '../lifecycle'
import type { TicketRecord } from '../record/schema'

const UNBIASED: Role[] = ['verifier', 'reviewer']

export const recordFor = (role: Role, record: TicketRecord): TicketRecord =>
  UNBIASED.includes(role) ? { ...record, handoff: '' } : record

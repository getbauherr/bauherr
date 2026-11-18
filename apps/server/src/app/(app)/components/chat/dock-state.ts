import { remember } from './api'

const EVENT = 'chat-dock'
let storageKey: string | null = null
export type DockRequest = 'focus' | 'new' | { ticket: number; mode: 'comment' }
let pending: DockRequest | null = null

type Saved = { open?: boolean; w?: number }
export const readSaved = (): Saved => {
  try {
    return JSON.parse((storageKey && remember.get(storageKey)) || '{}') as Saved
  } catch {
    return {}
  }
}
export const save = (patch: Saved) => storageKey && remember.set(storageKey, JSON.stringify({ ...readSaved(), ...patch }))
export const setStorageKey = (key: string) => void (storageKey = key)

export const isOpen = () => document.documentElement.dataset.chat === 'open'

export function setOpen(open: boolean) {
  if (open) document.documentElement.dataset.chat = 'open'
  else delete document.documentElement.dataset.chat
  save({ open })
  dispatchEvent(new Event(EVENT))
}

export const subscribe = (cb: () => void) => {
  addEventListener(EVENT, cb)
  return () => removeEventListener(EVENT, cb)
}

export function request(action: DockRequest) {
  pending = action
  setOpen(true)
  dispatchEvent(new Event(`${EVENT}-request`))
}
export const takeRequest = (): DockRequest | null => {
  const p = pending
  pending = null
  return p
}
export const onRequest = (cb: () => void) => {
  addEventListener(`${EVENT}-request`, cb)
  return () => removeEventListener(`${EVENT}-request`, cb)
}

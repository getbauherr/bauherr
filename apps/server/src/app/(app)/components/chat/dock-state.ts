import { remember } from './api'

const EVENT = 'chat-dock'
let storageKey: string | null = null
let pending: 'focus' | 'new' | null = null

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

/** Opens or closes the dock; the open state lives on `html[data-chat]` so CSS shows it without a render (and the pre-paint script can set it). */
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

/** Asks the (possibly not yet loaded) chat panel to do something once it is there: focus the composer, or start a new chat. */
export function request(action: 'focus' | 'new') {
  pending = action
  setOpen(true)
  dispatchEvent(new Event(`${EVENT}-request`))
}
export const takeRequest = (): 'focus' | 'new' | null => {
  const p = pending
  pending = null
  return p
}
export const onRequest = (cb: () => void) => {
  addEventListener(`${EVENT}-request`, cb)
  return () => removeEventListener(`${EVENT}-request`, cb)
}

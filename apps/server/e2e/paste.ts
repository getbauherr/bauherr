import type { Locator } from '@playwright/test'

export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** Pastes (or drops) one file into the composer through synthetic events carrying a DataTransfer. */
export const give = (input: Locator, how: 'paste' | 'drop', file: { name: string; type: string; base64?: string; size?: number }) =>
  input.evaluate(
    (el, { how, file }) => {
      const data = new DataTransfer()
      const bytes = file.base64 ? Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0)) : new Uint8Array(file.size ?? 0)
      data.items.add(new File([bytes], file.name, { type: file.type }))
      if (how === 'paste') return void el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      const form = el.closest('form')!.firstElementChild!
      for (const type of ['dragenter', 'dragover', 'drop']) form.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
    },
    { how, file },
  )

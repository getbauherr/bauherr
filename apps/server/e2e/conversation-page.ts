import type { Page } from '@playwright/test'

export const aConversation = async (page: Page): Promise<string> => {
  const base = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'factory', url: base }])
  await page.goto('/conversations')
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Scan' }),
    })
    return ((await res.json()) as { id: number }).id
  })
  return `/conversations/${id}`
}

export const conversationTargets = {
  '/conversations': async (page: Page): Promise<string> => {
    await aConversation(page)
    return '/conversations'
  },
  '/conversations/[id]': aConversation,
}

const requestOf = (title: string) => async (page: Page) => {
  const base = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url: base }])
  await page.goto('/inbox')
  const href = await page
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .getAttribute('href')
  return (href ?? '').replace('/tickets/', '/requests/')
}

export const requestTargets = {
  '/requests/[id]': {
    'plan waiting': requestOf('Brief with a mockup'),
    'ready to try': requestOf('Result to read'),
  },
}

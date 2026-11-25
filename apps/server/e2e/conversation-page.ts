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
  '/requests/new': async (page: Page): Promise<string> => {
    const base = process.env.BASE_URL ?? 'http://localhost:3000'
    await page.context().addCookies([{ name: 'bauherr-ws', value: 'requests', url: base }])
    return '/requests/new'
  },
}

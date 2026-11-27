export const SIGN_IN_FIRST = 'Sign in first.'

export const unauthorized = (error: string = SIGN_IN_FIRST): Response => Response.json({ error }, { status: 401 })

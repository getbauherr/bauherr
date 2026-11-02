import { widget } from '../embed'

export const runtime = 'nodejs'

/** The embeddable Intake widget. Public on purpose: it holds no secret, the embed token comes from the host page. */
export const GET = (): Response =>
  new Response(`(${widget.toString()})(document.currentScript)`, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' } })

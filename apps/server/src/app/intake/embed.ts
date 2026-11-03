/**
 * Embeddable Intake chat (served as /intake/widget.js). Self-contained: the route serves `widget.toString()`, so it must not
 * reference anything outside its body. Usage: `<script src="https://HOST/intake/widget.js" data-token="bemb_..."></script>`.
 */
export function widget(script: HTMLScriptElement | null): void {
  const token = script?.dataset.token
  if (!script || !token) return
  const base = new URL(script.src).origin
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    :host{all:initial;font:14px/1.4 system-ui,sans-serif;color:#1c1c1e}
    *{box-sizing:border-box}
    .fab{position:fixed;right:16px;bottom:16px;padding:10px 16px;border:0;border-radius:999px;background:#1c1c1e;color:#fff;font:inherit;cursor:pointer}
    section{position:fixed;right:16px;bottom:64px;width:min(360px,calc(100vw - 32px));max-height:min(520px,calc(100vh - 96px));display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid #d0d0d5;border-radius:12px;background:#fff;box-shadow:0 8px 32px #0003}
    section[hidden]{display:none}
    .log{overflow:auto;display:flex;flex-direction:column;gap:6px}
    .log p{margin:0;padding:6px 10px;border-radius:8px;max-width:90%;white-space:pre-wrap;overflow-wrap:anywhere}
    .bot{background:#f0f0f3}.me{background:#dbe8ff;align-self:flex-end}.err{background:#ffe0e0}
    .opts{display:flex;flex-wrap:wrap;gap:6px}
    button{font:inherit}
    .opts button,.submit{padding:4px 10px;border:1px solid #1c1c1e;border-radius:999px;background:#fff;cursor:pointer}
    .submit{background:#1c1c1e;color:#fff}
    form{display:flex;gap:6px}
    input{flex:1;min-width:0;padding:6px 8px;border:1px solid #d0d0d5;border-radius:8px;font:inherit}
    form button{padding:6px 12px;border:0;border-radius:8px;background:#1c1c1e;color:#fff;cursor:pointer}
    :disabled{opacity:.5;cursor:default}
  </style>
  <button class="fab">Report a problem</button>
  <section hidden><div class="log"></div><div class="opts"></div><button class="submit" hidden>Submit request</button><form><input maxlength="2000" placeholder="Describe it in one sentence" required><button>Send</button></form></section>`
  const $ = <T extends HTMLElement>(s: string): T => root.querySelector(s) as T
  const [fab, panel, log, opts, submit, form, input] = ['.fab', 'section', '.log', '.opts', '.submit', 'form', 'input'].map((s) => $(s)) as [HTMLButtonElement, HTMLElement, HTMLElement, HTMLElement, HTMLButtonElement, HTMLFormElement, HTMLInputElement]
  let session: number | null = null
  let count = 0
  const slot = `bauherr-intake:${token.slice(0, 8)}`
  const keep = (id: number | null) => {
    try {
      id === null ? localStorage.removeItem(slot) : localStorage.setItem(slot, String(id))
    } catch {}
  }
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = (path: string, body: object = {}) => fetch(`${base}/intake/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const say = (cls: string, text: string) => {
    const p = document.createElement('p')
    p.className = cls
    p.textContent = text
    log.append(p)
    log.scrollTop = log.scrollHeight
  }
  const offer = (d: { options?: { label: string }[]; split?: unknown[] | null; ready?: boolean; exhausted?: boolean }) => {
    count = d.split?.length ?? 0
    for (const o of d.options ?? []) {
      const b = document.createElement('button')
      b.textContent = o.label
      b.onclick = () => void send(o.label)
      opts.append(b)
    }
    submit.hidden = !(d.ready || d.exhausted)
  }
  const busy = (b: boolean) => root.querySelectorAll('button,input').forEach((e) => ((e as HTMLButtonElement).disabled = b))
  const send = async (text: string) => {
    say('me', text)
    opts.replaceChildren()
    submit.hidden = true
    busy(true)
    try {
      if (session === null) {
        const r = await call('sessions')
        if (!r.ok) throw new Error(String(r.status))
        session = ((await r.json()) as { id: number }).id
        keep(session)
      }
      const r = await call(`sessions/${session}/messages`, { text })
      if (!r.ok) throw new Error(String(r.status))
      for (const block of (await r.text()).split('\n\n')) {
        const [event, data] = block.split('\n').map((l) => l.slice(l.indexOf(': ') + 2))
        if (!data) continue
        const d = JSON.parse(data)
        if (event === 'error') throw new Error(d.message)
        say('bot', d.question)
        offer(d)
      }
    } catch {
      say('err', 'Something went wrong. Please try again.')
    }
    busy(false)
    input.focus()
  }
  fab.onclick = () => (panel.hidden = !panel.hidden)
  form.onsubmit = (e) => {
    e.preventDefault()
    const text = input.value.trim()
    input.value = ''
    if (text) void send(text)
  }
  submit.onclick = async () => {
    busy(true)
    try {
      const r = await call(`sessions/${session}/submit`, count ? { expect: count } : {})
      if (!r.ok) throw new Error(String(r.status))
      const { number, numbers } = (await r.json()) as { number: number; numbers?: number[] }
      say('bot', numbers ? `Thank you, your requests ${numbers.map((n) => `#${n}`).join(', ')} were created.` : `Thank you, your request #${number} was created.`)
      keep(null)
      submit.hidden = true
      opts.replaceChildren()
      input.disabled = true
    } catch {
      say('err', 'Could not submit. Please try again.')
      busy(false)
    }
  }
  document.body.append(host)
  let saved: string | null = null
  try {
    saved = localStorage.getItem(slot)
  } catch {}
  if (saved) {
    void (async () => {
      try {
        const r = await call(`sessions/${saved}`)
        const d = (await r.json()) as { status: string; messages: { role: string; content: string }[]; split: unknown[] | null; turn: { options?: { label: string }[]; ready?: boolean; exhausted?: boolean } | null }
        if (!r.ok || d.status !== 'open' || !d.messages.length) return keep(null)
        session = Number(saved)
        for (const m of d.messages) say(m.role === 'user' ? 'me' : 'bot', m.content)
        if (d.turn) offer({ ...d.turn, split: d.split })
      } catch {}
    })()
  }
}

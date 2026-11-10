import { ChatDockClient } from './dock-client'

const WIDE = 1024

/** Push the page at desktop width only; below it the dock is a sheet over the page. */
const css = `@media (min-width:${WIDE}px){html[data-chat=open] body{padding-right:var(--chat-w,400px)}}`

/** Sets the open state and width before first paint (the server renders it closed), the way the theme avoids its flash. */
const restore = (key: string) => `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'{}'),r=document.documentElement;if(s.w)r.style.setProperty('--chat-w',s.w+'px');if(s.open&&innerWidth>=${WIDE})r.dataset.chat='open'}catch(e){}`

/** The factory chat, docked on the right of every page: first element of the shell layout, so its script runs before the page paints. */
export function ChatDock({ userId }: { userId: number | string }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: restore(`bauherr-chat:${userId}`) }} />
      <style>{css}</style>
      <ChatDockClient userId={userId} />
    </>
  )
}

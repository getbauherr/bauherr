import { ChatDockClient } from './dock-client'

const WIDE = 1024

/** Sets the open state and width before first paint (the server renders it closed), the way the theme avoids its flash. */
const restore = (key: string) => `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'{}'),r=document.documentElement;if(s.w)r.style.setProperty('--chat-w',s.w+'px');if(s.open&&innerWidth>=${WIDE})r.dataset.chat='open'}catch(e){}`

/** The factory chat for the shell's dock slot: a flex column next to the content from 1024 px up, a sheet over the page below. */
export function ChatDock({ userId }: { userId: number | string }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: restore(`bauherr-chat:${userId}`) }} />
      <ChatDockClient userId={userId} />
    </>
  )
}

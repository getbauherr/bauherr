import { ChatDockClient } from './dock-client'

const WIDE = 1024

const restore = (key: string) => `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'{}'),r=document.documentElement;if(s.w)r.style.setProperty('--chat-w',s.w+'px');if(s.open&&innerWidth>=${WIDE})r.dataset.chat='open'}catch(e){}`

export function ChatDock({ userId }: { userId: number | string }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: restore(`bauherr-chat:${userId}`) }} />
      <ChatDockClient userId={userId} />
    </>
  )
}

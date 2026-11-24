import { ticketRefs } from '../lib/refs'
import { RefTextView } from './RefTextView'

export async function RefText({ text, repo }: { text: string; repo: string }) {
  return <RefTextView text={text} repo={repo} refs={await ticketRefs()} />
}

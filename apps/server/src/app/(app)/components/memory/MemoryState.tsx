import { Badge } from '../ui/badge'

export function MemoryState({ off }: { off: boolean }) {
  return off ? <Badge>Off</Badge> : <Badge variant="ok">Active</Badge>
}

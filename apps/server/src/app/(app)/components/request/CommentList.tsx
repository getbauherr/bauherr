import type { RequestComment } from '../../../../core/requests/comments'
import { Time } from '../Time'
import { CommentFiles } from './CommentFiles'

const ROLE_WORDS = { 'product-owner': 'product owner', bauherr: 'Bauherr' }

export function CommentList({ comments }: { comments: RequestComment[] }) {
  if (comments.length === 0) return null
  return (
    <section aria-label="Conversation so far" className="grid gap-3">
      <h3 className="label text-muted-foreground">Comments</h3>
      <ul className="m-0 grid list-none gap-3 p-0">
        {comments.map((comment) => (
          <li key={comment.id} data-comment className="grid gap-1 border-l-2 border-border pl-3">
            <span className="small text-muted-foreground">
              {comment.author} ({ROLE_WORDS[comment.role]}) · <Time iso={comment.at} />
            </span>
            {comment.text && <p className="m-0 whitespace-pre-wrap">{comment.text}</p>}
            <CommentFiles files={comment.files} />
          </li>
        ))}
      </ul>
    </section>
  )
}

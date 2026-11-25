'use client'

import { Composer } from '../conversation/Composer'
import { CommentRuntime } from '../ticket/CommentRuntime'

const NOT_YET = () => Promise.reject(new Error('Comments from this page are not open yet.'))

export function RequestComposer() {
  return (
    <CommentRuntime conversation={NOT_YET}>
      <Composer placeholder="Write a comment, add screenshots or files…" sendable={false} />
    </CommentRuntime>
  )
}

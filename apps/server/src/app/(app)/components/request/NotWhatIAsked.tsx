'use client'

import { Button } from '../ui/button'
import { COMMENT_FIELD } from './comment-field'

export function NotWhatIAsked() {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-fit"
      onClick={() => {
        const field = document.getElementById(COMMENT_FIELD)
        field?.scrollIntoView({ block: 'center' })
        field?.focus()
      }}
    >
      Not what I asked for
    </Button>
  )
}

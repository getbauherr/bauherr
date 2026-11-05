'use client'
import { useActionState, useId } from 'react'
import { saveKnowledgeDocument, type EditState } from '../lib/actions'
import { NextStepBar } from './NextStepBar'
import { Textarea } from './ui/textarea'

/** Text area plus save; a stale save shows the changes and the next save is made against the current version. */
export function KnowledgeEditor({ path, content, sha }: { path: string; content: string; sha: string }) {
  const [state, action, pending] = useActionState<EditState, FormData>(saveKnowledgeDocument, {})
  const formId = useId()
  return (
    <form id={formId} action={action} className="flex flex-col gap-4">
      <NextStepBar sentence={state.stale ? 'This document changed. Check the changes below, then save again.' : 'Your change is checked and published automatically.'} primary={{ label: state.stale ? 'Save over current version' : 'Save', disabled: pending, form: formId }}>
        {state.pr && <span role="status" className="small text-ok">Saved. Your change goes live once its checks pass.</span>}
        {state.error && <span role="alert" className="small text-destructive">{state.error}</span>}
      </NextStepBar>
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="baseSha" value={state.stale?.sha ?? sha} />
      <div className="flex flex-col gap-1">
        <label htmlFor="content" className="small text-muted-foreground">Document text</label>
        <Textarea id="content" name="content" className="mono w-full resize-y leading-normal!" rows={24} defaultValue={content} spellCheck />
      </div>
      {state.stale && (
        <div role="alert">
          <p className="small text-destructive">This document changed since you opened it. Changes from the current version to yours:</p>
          <pre className="mono overflow-auto rounded-md border border-border bg-secondary p-3 break-words whitespace-pre-wrap">{state.stale.diff}</pre>
        </div>
      )}
    </form>
  )
}

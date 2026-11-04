'use client'
import { useActionState } from 'react'
import { saveKnowledgeDocument, type EditState } from '../lib/actions'

/** Text area plus save; a stale save shows the changes and the next save is made against the current version. */
export function KnowledgeEditor({ path, content, sha }: { path: string; content: string; sha: string }) {
  const [state, action, pending] = useActionState<EditState, FormData>(saveKnowledgeDocument, {})
  return (
    <form action={action} className="sform">
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="baseSha" value={state.stale?.sha ?? sha} />
      <div className="field">
        <label htmlFor="content" className="small muted">Document text</label>
        <textarea id="content" name="content" className="mono editor" rows={24} defaultValue={content} spellCheck />
      </div>
      {state.stale && (
        <div role="alert">
          <p className="small err">This document changed since you opened it. Changes from the current version to yours:</p>
          <pre className="mono diff">{state.stale.diff}</pre>
        </div>
      )}
      <div className="actions">
        <button className="btn primary" disabled={pending}>{state.stale ? 'Save over current version' : 'Save'}</button>
        {state.pr && <span role="status" className="small ok">Saved. Your change goes live once its checks pass.</span>}
        {state.error && <span role="alert" className="small err">{state.error}</span>}
      </div>
    </form>
  )
}

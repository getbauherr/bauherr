import type { ReactNode } from 'react'
import Link from 'next/link'
import { CopyButton } from './CopyButton'

/** "Connect a session" steps: the `claude mcp add` line, the role prompt and what to expect. `keyStep` replaces the link to the key page (the setup wizard creates the key right above). */
export function ConnectBlock({ mcpLine, prompt, docsHref, keyStep }: { mcpLine: string; prompt: string; docsHref: string; keyStep?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4" data-testid="connect">
      {!keyStep && <h3 className="heading">Connect a session</h3>}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        <li className="group flex flex-col gap-2">
          <span className="small">1. Add the factory to Claude Code once. {keyStep ? 'Create an agent key; the ready-made command with the key is shown once.' : <><Link className="text-primary" href="/settings/api-key">Create an agent key</Link> and put it in place of the placeholder.</>}</span>
          {keyStep}
          {keyStep && <span className="small hidden text-muted-foreground group-has-[[role=status]]:block">Shown once. Copy it now.</span>}
          <div className="flex flex-col gap-2 group-has-[[role=status]]:hidden">
            <pre className="mono m-0 overflow-x-auto rounded-md bg-secondary p-3 whitespace-pre-wrap">{mcpLine}</pre>
            <div><CopyButton text={mcpLine} label="Copy command" /></div>
          </div>
        </li>
        <li className="flex flex-col gap-2">
          <span className="small">2. Start a session and give it this prompt.</span>
          <pre className="mono m-0 overflow-x-auto rounded-md bg-secondary p-3 whitespace-pre-wrap">{prompt}</pre>
          <div><CopyButton text={prompt} label="Copy prompt" /></div>
        </li>
        <li className="small">3. The session appears here as Idle within seconds, and as Working while it holds a Run.</li>
      </ol>
      <a className="small text-primary" href={docsHref}>How sessions connect</a>
    </div>
  )
}

'use client'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import type { FC, ReactNode } from 'react'
import { Ellipsis } from '@/components/icons'
import { cn } from '@/lib/utils'
import { AgentCard } from '../assistant-ui/elements/agent-card'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { RoleAvatar } from '../team/RoleAvatar'
import type { Participant } from '../../../../lib/refine/engine'
import { shortModel } from '../../lib/format'

/**
 * Who the conversation is with: the role as persona (avatar, name), and one line under it that says who really talks: the session that asked, the Factory assistant that replies,
 * the model. The chevron opens the agent card (role profile, session, client, model, Run link). `menu` is the page's "more" menu.
 */
export const ParticipantHeader: FC<{ participant: Participant; model: string; subtitle: string; /** What the one line under the name says the Factory assistant does. */ line?: string; menu?: ReactNode; /** The heading level of the name: 2 when the page already has its own title. */ level?: 1 | 2 }> = ({ participant: p, model, subtitle, line = 'Factory assistant replies', menu, level = 1 }) => {
  const H = `h${level}` as const
  const s = p.session
  const short = shortModel(model)
  return (
    <header data-testid="participant" className="flex items-start gap-3">
      <RoleAvatar avatar={p.avatar} size="md" animate={!!s?.live} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <H className="m-0 flex flex-wrap items-baseline gap-x-2 text-[17px] leading-6 font-semibold">{p.role}{subtitle && <span className="text-[13px] font-normal text-muted-foreground">{subtitle}</span>}</H>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" data-testid="participant-line" className="flex w-fit max-w-full cursor-pointer items-center gap-1.5 text-left text-[13px] text-muted-foreground hover:text-foreground">
              <span className="sr-only">Who is talking: </span>
              {s && <span role="img" aria-label={s.live ? 'connected' : 'not connected'} className={cn('size-2 shrink-0 rounded-full', s.live ? 'bg-ok' : 'bg-muted-foreground/50')} />}
              <span className="min-w-0 truncate">{s && <span className="max-sm:hidden">{s.label} asked · </span>}{line}{model && <span className="max-sm:hidden"> · <span data-testid="header-model" title={model} className="font-mono text-[12px]">{short}</span></span>}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 border-0 bg-transparent p-0">
            <AgentCard
              data-testid="agent-card"
              avatar={<RoleAvatar avatar={p.avatar} size="md" animate={false} />}
              name={p.role}
              description={p.about || 'Triages new Tickets and asks what the plan needs.'}
              facts={[
                ...(s ? [{ label: 'Asked by session', value: s.label }, { label: 'Client', value: s.client ?? '—' }, { label: 'Session model', value: s.model ?? '—' }] : []),
                { label: 'Replies', value: 'Factory assistant' },
                ...(model ? [{ label: 'Reply model', value: <span title={model} className="font-mono">{short}</span> }] : []),
              ]}
            >
              {s?.run != null && <Link href={`/runs/${s.run}`} className="text-[13px] text-primary hover:underline">Run #{s.run}</Link>}
            </AgentCard>
          </PopoverContent>
        </Popover>
      </div>
      {menu && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="More" data-testid="more" className="size-8"><Ellipsis /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  )
}

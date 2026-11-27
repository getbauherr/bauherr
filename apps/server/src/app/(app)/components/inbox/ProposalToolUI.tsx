'use client'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { useContext, useState } from 'react'
import { cn } from '@/lib/utils'
import type { DecisionModel, DecisionOption } from '../../lib/inbox-decision'
import { canConfirm } from '../../lib/inbox-input'
import { PROPOSAL_TOOL, stagedOf, type Proposal } from '../../lib/inbox-steer'
import { paper } from '../assistant-ui/elements/surfaces'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { CriteriaPicker, NoteField } from './DecisionParts'
import { PendingContext, ProposalDoneContext } from './DecisionToolUI'

type DecideProposal = Extract<Proposal, { kind: 'decide' }>
type Confirm = (input: DecideProposal['input']) => void
type FormProps = { proposal: DecideProposal; model: DecisionModel; option: DecisionOption; onConfirm: Confirm }

function DecideForm({ proposal, model, option, onConfirm }: FormProps) {
  const { input } = proposal
  const [ticked, setTicked] = useState(input.criteria ?? [])
  const [note, setNote] = useState(input.note ?? '')
  const form = { note, ticked, answers: input.answers ?? {} }
  const trimmed = note.trim() === '' ? {} : { note: note.trim() }
  const edited = { ...input, ...trimmed, ...(option.criteria ? { criteria: ticked } : {}) }
  return (
    <>
      {model.criteria && option.criteria && (
        <CriteriaPicker criteria={model.criteria} ticked={ticked} onChange={setTicked} />
      )}
      {option.note && <NoteField spec={option.note} value={note} onChange={setNote} />}
      <div>
        <Button disabled={!canConfirm(option, form)} onClick={() => onConfirm(edited)}>
          {option.criteria ? 'Drop criteria' : option.label}
        </Button>
      </div>
    </>
  )
}

function Decide({ proposal, onConfirm }: { proposal: DecideProposal; onConfirm: Confirm }) {
  const { model } = proposal
  const option = model?.options.find((candidate) => candidate.choice === proposal.input.choice)
  return model && option ? <DecideForm proposal={proposal} model={model} option={option} onConfirm={onConfirm} /> : null
}

function Comment({ body, onConfirm }: { body: string; onConfirm: (text: string) => void }) {
  const [text, setText] = useState(body)
  return (
    <>
      <Textarea aria-label="Words for the agent" value={text} onChange={(event) => setText(event.target.value)} />
      <div>
        <Button disabled={text.trim() === ''} onClick={() => onConfirm(text.trim())}>
          Pass to the agent
        </Button>
      </div>
    </>
  )
}

function Card({ proposal }: { proposal: Proposal }) {
  const pending = useContext(PendingContext)
  const done = useContext(ProposalDoneContext)
  if (!pending) return null
  const { recordId, number } = proposal
  const stage = (outcome: Parameters<typeof stagedOf>[1]) => {
    const staged = stagedOf({ recordId, number }, outcome, Date.now())
    if (staged) pending.stage(staged)
    done()
  }
  return (
    <div className={cn(paper, 'flex w-full max-w-lg flex-col gap-3 rounded-[20px] p-5')}>
      {proposal.kind === 'decide' ? (
        <Decide proposal={proposal} onConfirm={(input) => stage({ kind: 'decide', input })} />
      ) : (
        <Comment body={proposal.body} onConfirm={(body) => stage({ kind: 'comment', body })} />
      )}
    </div>
  )
}

export const ProposalToolUI = makeAssistantToolUI<Proposal, string>({
  toolName: PROPOSAL_TOOL,
  render: ({ args }) => <Card proposal={args} />,
})

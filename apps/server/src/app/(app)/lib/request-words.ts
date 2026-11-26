import type { RequestStory } from '../../../core/views/request-story'
import type { TicketStatus } from '../../../core/views/status'
import type { StatusWord } from './status-words'

export type Turn = 'you' | 'bauherr' | 'factory' | 'nobody'
export type RequestWords = { chip: StatusWord; now: string; turn: Turn }

const w = (chip: StatusWord, now: string, turn: Turn): RequestWords => ({ chip, now, turn })

const HELD = 'The team is held up. A Bauherr decides how to go on.'
const WAITING = 'The team has not started yet. Nothing is needed from you.'
const CHECKING = 'The change is being checked. Nothing is needed from you.'

const HELD_CHIP: StatusWord = { word: 'Held up', tone: 'destructive', mark: 'cross' }
const ON_ITS_WAY = 'The change is on its way to staging. Nothing is needed from you.'
const READING = 'The factory is reading your request and may ask a question.'
const ASKED = 'The factory asked you a question. Answer it in a comment.'
const AUTHOR = 'The author of the pull request is expected to move on.'
const PLAN_WAITS =
  'The plan is ready and waits for approval by a Bauherr. ' +
  'Comment if anything should change; they see it before they decide.'
const TRY_IT =
  'Try it on staging. Comment if it is not what you asked for; a Bauherr sees your comment before accepting it.'

export const TURN_WORDS: Record<Turn, string> = {
  you: 'Your turn',
  bauherr: "A Bauherr's turn",
  factory: "The factory's turn",
  nobody: 'Nothing left to do',
}

export const REQUEST_WORDS: Record<TicketStatus, RequestWords> = {
  triaging: w({ word: 'Being read', tone: 'accent' }, READING, 'factory'),
  'drafting-brief': w({ word: 'Plan being written', tone: 'accent' }, 'The factory is writing the plan.', 'factory'),
  building: w({ word: 'Being built', tone: 'accent' }, 'The change is being built.', 'factory'),
  reviewing: w({ word: 'Being checked', tone: 'accent' }, CHECKING, 'factory'),
  verifying: w({ word: 'Being checked', tone: 'accent' }, CHECKING, 'factory'),
  queued: w({ word: 'Waiting for the team', tone: 'neutral', mark: 'clock' }, WAITING, 'factory'),
  'waiting-for-checks': w({ word: 'Being checked', tone: 'neutral', mark: 'clock' }, CHECKING, 'factory'),
  'waiting-for-deploy': w({ word: 'Going to staging', tone: 'neutral', mark: 'clock' }, ON_ITS_WAY, 'factory'),
  'reporter-asked': w({ word: 'Question for you', tone: 'warn' }, ASKED, 'you'),
  'question-drafted': w({ word: 'Being read', tone: 'neutral' }, 'The factory is preparing a question.', 'factory'),
  'waiting-on-author': w({ word: 'Waiting for the author', tone: 'neutral' }, AUTHOR, 'nobody'),
  'brief-needs-approval': w({ word: 'Plan waiting for approval', tone: 'warn' }, PLAN_WAITS, 'bauherr'),
  'result-ready': w({ word: 'Ready to try', tone: 'ok' }, TRY_IT, 'you'),
  question: w({ word: 'A Bauherr decides', tone: 'warn' }, 'A Bauherr is deciding how to go on.', 'bauherr'),
  'failed-runs': w(HELD_CHIP, HELD, 'bauherr'),
  'verify-rounds': w(HELD_CHIP, HELD, 'bauherr'),
  'reporter-silent': w(HELD_CHIP, HELD, 'bauherr'),
  parked: w({ word: 'Waiting for the team', tone: 'neutral' }, WAITING, 'bauherr'),
  'parked-on-need': w({ word: 'Waiting for the team', tone: 'warn' }, WAITING, 'bauherr'),
  accepted: w({ word: 'Done', tone: 'ok', mark: 'check' }, 'The request is done and closed.', 'nobody'),
  closed: w({ word: 'Closed', tone: 'neutral' }, 'The request is closed.', 'nobody'),
}

export const chipOf = (story: Pick<RequestStory, 'status' | 'live'>): StatusWord =>
  story.live ? { word: `Live in ${story.live.version}`, tone: 'ok', mark: 'check' } : REQUEST_WORDS[story.status].chip

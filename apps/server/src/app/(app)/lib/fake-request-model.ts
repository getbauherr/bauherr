import type { RequestModel } from '../../../core/requests/turn'

const ROUNDS = /"rounds":(\d+)/

const TITLE = 'Excel export of the full balance stops for large municipalities'

const question = (field: string, text: string, options: string[], suggested: string) => ({
  field,
  text,
  options,
  suggested,
})

const firstBug = {
  reply: 'That sounds like something that is broken. Three questions so the team can reproduce it:',
  type: 'bug',
  confirm: 'That sounds like something that is broken. Right?',
  title: TITLE,
  summary: 'The export of the CO2 balance stops for big cities.',
  fields: { happened: 'The export spinner runs, then nothing.', where: 'CO2 balance, Export' },
  questions: [
    question('expected', 'What did you expect?', ['The file downloads', 'A message', 'Other'], 'The file downloads'),
    question('steps', 'Does it work for a small municipality?', ['Yes', 'No', 'Not tried'], 'Not tried'),
    question('frequency', 'Every time, or sometimes?', ['Every time', 'Sometimes'], 'Every time'),
  ],
}

const lastBug = {
  reply: 'Thank you. The card is complete: send it when you are ready.',
  type: 'bug',
  title: TITLE,
  summary: 'The export of the CO2 balance stops for big cities.',
  fields: {
    expected: 'The file downloads',
    steps: 'Open the CO2 balance, press Export for a big city',
    frequency: 'Every time',
  },
  questions: [],
}

const answer = (said: string) => ({
  reply: 'Exports run nightly.',
  type: 'question',
  title: 'When do exports run?',
  fields: { question: said },
  answer: 'Exports run nightly.',
})

export const fakeRequestModel: RequestModel = (_workspace, system, turns) => {
  const rounds = Number(ROUNDS.exec(system)?.[1] ?? 0)
  const said = turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content)
    .join('\n')
  const asking = /\?\s*$/.test(said) && !/break|broken|stops/i.test(said)
  return Promise.resolve(JSON.stringify(asking ? answer(said) : rounds === 0 ? firstBug : lastBug))
}

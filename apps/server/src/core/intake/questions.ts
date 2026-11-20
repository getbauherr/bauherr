export type Question = { text: string; suggested: string }

export const questionsHeading = (round: number): string => `Questions, round ${round}`

export const QUESTIONS_HEADING = /^Questions, round (\d+)/

export const questionsBody = (round: number, questions: Question[]): string =>
  [
    questionsHeading(round),
    ...questions.map((q, i) => `${i + 1}. ${q.text}\n   Suggested: ${q.suggested}`),
    'Answer "yes" to accept every suggestion, or reply with a number and your answer.',
  ].join('\n\n')

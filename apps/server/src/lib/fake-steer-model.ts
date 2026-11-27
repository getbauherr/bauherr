import type { RetroModel } from '../core/retro/model'

const OPTIONS = /"options":\[([^\]]*)\]/

const optionsOf = (system: string): string[] =>
  [...(OPTIONS.exec(system)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '')

const reply = (body: object): Promise<string> => Promise.resolve(JSON.stringify(body))

export const fakeSteerModel: RetroModel = (_workspace, system, turns) => {
  const said = turns.at(-1)?.content ?? ''
  if (said.trim().endsWith('?')) return reply({ say: 'Because the first answer was a draft.', tool: 'answer' })
  const option = optionsOf(system).find((candidate) => said.toLowerCase().includes(candidate))
  if (option) return reply({ say: 'Understood.', tool: option })
  return reply({ say: 'I pass that on.', tool: 'comment_to_agent', note: said })
}

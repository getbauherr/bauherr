export type Phase = 1 | 2 | 3 | 4
export type StepState = 'done' | 'current' | 'waiting'

export const phaseOf = (input: { sources: number; syncCompleted: boolean; active: boolean }): Phase => {
  if (input.active) return 4
  if (input.sources === 0) return 1
  return input.syncCompleted ? 3 : 2
}

export const stepState = (step: Phase, phase: Phase): StepState => {
  if (phase === 4 || step < phase) return 'done'
  return step === phase ? 'current' : 'waiting'
}

import { countsOf, learnResultSchema } from '../../core/learn-result'
import { defineModule } from '../../core/module'
import { lessonProblems } from '../../core/memory-store'

export const learn = defineModule({
  stage: 'done',
  role: 'reviewer',
  writes: [],
  resultSchema: learnResultSchema,
  check: lessonProblems,
  apply: (_record, result, run) => ({
    patch: {},
    events: [{ type: 'learn.submitted', data: { runId: String(run.id), ...countsOf(result) } }],
    memory: result,
  }),
})

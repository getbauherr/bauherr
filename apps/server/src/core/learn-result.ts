import { z } from 'zod'
import { MEMORY_MAX } from './memory'

export const LESSONS_MAX = 5
export const LEARN_APPLIES = ['fit', 'area'] as const

const reference = z.string().regex(/^[fn][1-9][0-9]*$/, 'is the id of a finding (f1) or a correction note (n1)')
const memoryId = z.number().int().positive()

const repeated = z.strictObject({ from: reference, repeats: memoryId })

const written = z
  .strictObject({
    from: reference,
    text: z.string().trim().min(1).max(MEMORY_MAX),
    applies: z.enum(LEARN_APPLIES),
    area: z.string().trim().min(1).optional(),
  })
  .refine((lesson) => (lesson.applies === 'area') === (lesson.area !== undefined), {
    message: 'give area exactly when applies is area',
    path: ['area'],
  })

export const learnResultSchema = z.strictObject({
  lessons: z.array(z.union([repeated, written])).max(LESSONS_MAX),
  cameBack: z.array(memoryId),
})

export type LearnResult = z.infer<typeof learnResultSchema>
export type Lesson = LearnResult['lessons'][number]
export type NewLesson = z.infer<typeof written>

export const isRepeat = (lesson: Lesson): lesson is z.infer<typeof repeated> => 'repeats' in lesson

export const countsOf = (result: LearnResult): { memories: number; cameBack: number } => ({
  memories: result.lessons.filter((lesson) => !isRepeat(lesson)).length,
  cameBack: new Set([...result.cameBack, ...result.lessons.filter(isRepeat).map((lesson) => lesson.repeats)]).size,
})

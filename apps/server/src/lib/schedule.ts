import type { TaskConfig } from 'payload'

type Schedule = NonNullable<TaskConfig['schedule']>

/** Poll-queue schedule whose failed scheduling attempts are logged with the task slug instead of vanishing. */
export const scheduled = (cron: string): Schedule => [{
  cron,
  queue: 'poll',
  hooks: {
    afterSchedule: async (args) => {
      await args.defaultAfterSchedule(args)
      if (args.status === 'error') args.req.payload.logger.error({ err: args.error, task: args.queueable.taskConfig?.slug }, 'schedule failed')
    },
  },
}]

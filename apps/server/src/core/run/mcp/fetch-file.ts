import { z } from 'zod'
import { commentFileOf } from '../../conversations/store'
import { FileNotFound } from '../errors'
import { authorize } from '../leases'
import { defineTool, leaseToken, ownRun, runId } from './tool'

export const fetchFile = defineTool({
  name: 'fetch_file',
  description:
    'Returns { name, contentType, bytes, base64 } for a file attached to a comment of the ticket of your run: ' +
    'give the fileId from commentFiles in the pack. Files are images, PDFs or text, at most 10 MB.',
  access: 'agent',
  input: z.strictObject({ runId, leaseToken, fileId: z.number().int().positive() }),
  run: async (value, context) => {
    const { payload } = context.deps
    await ownRun(context, value.runId)
    const run = await authorize(payload, value.runId, value.leaseToken)
    const file = await commentFileOf(payload, run.recordId, value.fileId)
    if (!file) {
      throw new FileNotFound(`File ${value.fileId} is not on a comment of this ticket: use an id from commentFiles.`)
    }
    return file
  },
})

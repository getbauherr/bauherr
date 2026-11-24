import { ask } from './ask'
import { attachProof } from './attach-proof'
import { connect } from './connect'
import { decide } from './decide'
import { release, submit } from './finish'
import { fetchFile } from './fetch-file'
import { heartbeat } from './heartbeat'
import { next } from './next-work'
import { search } from './search'
import { UnknownTool } from '../errors'
import type { Contexts, Tool } from './tool'

export const TOOLS: Tool[] = [connect, next, heartbeat, search, attachProof, fetchFile, ask, submit, release, decide]

export const callTool = async (name: string, raw: unknown, contexts: Partial<Contexts>): Promise<unknown> => {
  const tool = TOOLS.find((candidate) => candidate.name === name)
  if (!tool) throw new UnknownTool(`There is no tool ${name}: list the tools first.`)
  return tool.call(raw, contexts)
}

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Stage } from './core/events'
import type { Modules } from './core/module'
import { brief } from './modules/brief/module'
import { build } from './modules/build/module'
import { intake } from './modules/intake/module'
import { verify } from './modules/verify/module'

export const MODULES: Modules = { intake, brief, build, verify }

const SKILLS_DIR = join(resolve(process.env.BAUHERR_PACK_DIR ?? join(process.cwd(), '..', '..', 'pack')), 'skills')

export const skillFor = async (stage: Stage): Promise<string | null> => {
  if (!(stage in MODULES)) return null
  try {
    return await readFile(join(SKILLS_DIR, `${stage}.md`), 'utf8')
  } catch {
    return null
  }
}

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import type { Stage } from './core/events'
import { moduleKey, type Modules } from './core/module'
import { DEFAULT_TIER, type Tier } from './core/run/schema'
import { tierIn } from './core/run/tiers'
import type { Role } from './core/lifecycle'
import { brief } from './modules/brief/module'
import { build } from './modules/build/module'
import { intake } from './modules/intake/module'
import { review } from './modules/review/module'
import { verify } from './modules/verify/module'

export const MODULES: Modules = { intake, brief, build, review, verify }

const PACK_DIR = resolve(process.env.BAUHERR_PACK_DIR ?? join(process.cwd(), '..', '..', 'pack'))
const SKILLS_DIR = join(PACK_DIR, 'skills')

export const skillFor = async (stage: Stage, role: Role): Promise<string | null> => {
  const key = moduleKey(stage, role)
  if (!(key in MODULES)) return null
  try {
    return await readFile(join(SKILLS_DIR, `${key}.md`), 'utf8')
  } catch {
    return null
  }
}

export const tierFor = async (role: Role): Promise<Tier> => {
  try {
    return tierIn(parse(await readFile(join(PACK_DIR, 'pack.yaml'), 'utf8')), role)
  } catch {
    return DEFAULT_TIER
  }
}

export const retroSkill = (): Promise<string> => readFile(join(SKILLS_DIR, 'retro.md'), 'utf8')

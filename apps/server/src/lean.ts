import type { Modules } from './core/module'
import { brief } from './modules/brief/module'
import { build } from './modules/build/module'
import { intake } from './modules/intake/module'
import { verify } from './modules/verify/module'

export const MODULES: Modules = { intake, brief, build, verify }

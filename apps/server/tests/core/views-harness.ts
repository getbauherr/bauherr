import { advance } from '../../src/core/engine'
import type { Engine } from './harness'
import { openEngine } from './harness'
import { seedScenario, type Scenario, type ScenarioNames } from './scenario'

export type { ItemFields } from './scenario'
export type Names = ScenarioNames & { foreign: number }
export type Seeded = Omit<Scenario, 'names'> & { e: Engine; names: Names }

export const openViews = (suite: string): Promise<Engine> => openEngine(suite)

export const seed = async (e: Engine): Promise<Seeded> => {
  const scenario = await seedScenario(e)
  const foreign = await e.db.fresh(e.db.otherWorkspace)
  await advance(foreign, e.deps())
  return { e, names: { ...scenario.names, foreign }, source: scenario.source, item: scenario.item }
}

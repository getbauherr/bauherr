import * as migration_20261029_165423_initial from './20261029_165423_initial';
import * as migration_20261030_000000_reconcile_costs from './20261030_000000_reconcile_costs';
import * as migration_20261030_120000_provider_presets from './20261030_120000_provider_presets';

export const migrations = [
  {
    up: migration_20261029_165423_initial.up,
    down: migration_20261029_165423_initial.down,
    name: '20261029_165423_initial'
  },
  {
    up: migration_20261030_000000_reconcile_costs.up,
    down: migration_20261030_000000_reconcile_costs.down,
    name: '20261030_000000_reconcile_costs'
  },
  {
    up: migration_20261030_120000_provider_presets.up,
    down: migration_20261030_120000_provider_presets.down,
    name: '20261030_120000_provider_presets'
  },
];

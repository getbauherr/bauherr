import * as migration_20261029_165423_initial from './20261029_165423_initial';
import * as migration_20261030_000000_reconcile_costs from './20261030_000000_reconcile_costs';
import * as migration_20261030_120000_provider_presets from './20261030_120000_provider_presets';
import * as migration_20261030_130000_ui_prefs from './20261030_130000_ui_prefs';
import * as migration_20261030_130000_oidc from './20261030_130000_oidc';
import * as migration_20261030_140000_active_run_unique from './20261030_140000_active_run_unique';
import * as migration_20261030_150000_ticket_source_poll from './20261030_150000_ticket_source_poll';
import * as migration_20261030_160000_release_stage from './20261030_160000_release_stage';
import * as migration_20261030_170000_watch_release_job from './20261030_170000_watch_release_job';
import * as migration_20261030_170000_ticket_lease from './20261030_170000_ticket_lease';
import * as migration_20261030_180000_review_stage from './20261030_180000_review_stage';
import * as migration_20261030_190000_ticket_rank from './20261030_190000_ticket_rank';
import * as migration_20261030_191000_gate_notify from './20261030_191000_gate_notify';

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
  {
    up: migration_20261030_130000_ui_prefs.up,
    down: migration_20261030_130000_ui_prefs.down,
    name: '20261030_130000_ui_prefs'
  },
  {
    up: migration_20261030_130000_oidc.up,
    down: migration_20261030_130000_oidc.down,
    name: '20261030_130000_oidc'
  },
  {
    up: migration_20261030_140000_active_run_unique.up,
    down: migration_20261030_140000_active_run_unique.down,
    name: '20261030_140000_active_run_unique'
  },
  {
    up: migration_20261030_150000_ticket_source_poll.up,
    down: migration_20261030_150000_ticket_source_poll.down,
    name: '20261030_150000_ticket_source_poll'
  },
  {
    up: migration_20261030_160000_release_stage.up,
    down: migration_20261030_160000_release_stage.down,
    name: '20261030_160000_release_stage'
  },
  {
    up: migration_20261030_170000_watch_release_job.up,
    down: migration_20261030_170000_watch_release_job.down,
    name: '20261030_170000_watch_release_job'
  },
  {
    up: migration_20261030_170000_ticket_lease.up,
    down: migration_20261030_170000_ticket_lease.down,
    name: '20261030_170000_ticket_lease'
  },
  {
    up: migration_20261030_180000_review_stage.up,
    down: migration_20261030_180000_review_stage.down,
    name: '20261030_180000_review_stage'
  },
  {
    up: migration_20261030_190000_ticket_rank.up,
    down: migration_20261030_190000_ticket_rank.down,
    name: '20261030_190000_ticket_rank'
  },
  {
    up: migration_20261030_191000_gate_notify.up,
    down: migration_20261030_191000_gate_notify.down,
    name: '20261030_191000_gate_notify'
  },
];

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
import * as migration_20261030_190000_sub_tickets from './20261030_190000_sub_tickets';
import * as migration_20261030_190000_ticket_rank from './20261030_190000_ticket_rank';
import * as migration_20261030_191000_gate_notify from './20261030_191000_gate_notify';
import * as migration_20261030_192000_triage_stage from './20261030_192000_triage_stage';
import * as migration_20261030_194000_triage_attempts from './20261030_194000_triage_attempts';
import * as migration_20261102_150138_ticket_external_unique from './20261102_150138_ticket_external_unique';
import * as migration_20261102_150143_provider_auth_modes from './20261102_150143_provider_auth_modes';
import * as migration_20261102_150144_connection_slugs from './20261102_150144_connection_slugs';
import * as migration_20261102_150170_requeue_expired_unclaimed_runs from './20261102_150170_requeue_expired_unclaimed_runs';

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
    up: migration_20261030_190000_sub_tickets.up,
    down: migration_20261030_190000_sub_tickets.down,
    name: '20261030_190000_sub_tickets'
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
  {
    up: migration_20261030_192000_triage_stage.up,
    down: migration_20261030_192000_triage_stage.down,
    name: '20261030_192000_triage_stage'
  },
  {
    up: migration_20261030_194000_triage_attempts.up,
    down: migration_20261030_194000_triage_attempts.down,
    name: '20261030_194000_triage_attempts'
  },
  {
    up: migration_20261102_150138_ticket_external_unique.up,
    down: migration_20261102_150138_ticket_external_unique.down,
    name: '20261102_150138_ticket_external_unique'
  },
  {
    up: migration_20261102_150143_provider_auth_modes.up,
    down: migration_20261102_150143_provider_auth_modes.down,
    name: '20261102_150143_provider_auth_modes'
  },
  {
    up: migration_20261102_150144_connection_slugs.up,
    down: migration_20261102_150144_connection_slugs.down,
    name: '20261102_150144_connection_slugs'
  },
  {
    up: migration_20261102_150170_requeue_expired_unclaimed_runs.up,
    down: migration_20261102_150170_requeue_expired_unclaimed_runs.down,
    name: '20261102_150170_requeue_expired_unclaimed_runs'
  },
];

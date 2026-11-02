import * as migration_20261029_165423_initial from './20261029_165423_initial';
import * as migration_20261030_000000_reconcile_costs from './20261030_000000_reconcile_costs';
import * as migration_20261030_120000_provider_presets from './20261030_120000_provider_presets';
import * as migration_20261030_130000_oidc from './20261030_130000_oidc';
import * as migration_20261030_130000_ui_prefs from './20261030_130000_ui_prefs';
import * as migration_20261030_140000_active_run_unique from './20261030_140000_active_run_unique';
import * as migration_20261030_150000_ticket_source_poll from './20261030_150000_ticket_source_poll';
import * as migration_20261030_160000_release_stage from './20261030_160000_release_stage';
import * as migration_20261030_170000_ticket_lease from './20261030_170000_ticket_lease';
import * as migration_20261030_170000_watch_release_job from './20261030_170000_watch_release_job';
import * as migration_20261030_180000_review_stage from './20261030_180000_review_stage';
import * as migration_20261030_190000_sub_tickets from './20261030_190000_sub_tickets';
import * as migration_20261030_190000_ticket_rank from './20261030_190000_ticket_rank';
import * as migration_20261030_191000_gate_notify from './20261030_191000_gate_notify';
import * as migration_20261030_192000_triage_stage from './20261030_192000_triage_stage';
import * as migration_20261030_194000_triage_attempts from './20261030_194000_triage_attempts';
import * as migration_20261102_150084_production_gate from './20261102_150084_production_gate';
import * as migration_20261102_150119_gitlab_connection from './20261102_150119_gitlab_connection';
import * as migration_20261102_150138_ticket_external_unique from './20261102_150138_ticket_external_unique';
import * as migration_20261102_150142_gate_unreachable from './20261102_150142_gate_unreachable';
import * as migration_20261102_150143_provider_auth_modes from './20261102_150143_provider_auth_modes';
import * as migration_20261102_150144_connection_slugs from './20261102_150144_connection_slugs';
import * as migration_20261102_150145_intake_sessions from './20261102_150145_intake_sessions';
import * as migration_20261102_150147_media from './20261102_150147_media';
import * as migration_20261102_150150_knowledge from './20261102_150150_knowledge';
import * as migration_20261102_150166_agent_keys from './20261102_150166_agent_keys';
import * as migration_20261102_150168_conflict_return_scope from './20261102_150168_conflict_return_scope';
import * as migration_20261102_150170_requeue_expired_unclaimed_runs from './20261102_150170_requeue_expired_unclaimed_runs';
import * as migration_20261102_160000_production_approved_sha from './20261102_160000_production_approved_sha';
import * as migration_20261102_170000_intake_session_user from './20261102_170000_intake_session_user';
import * as migration_20261102_170000_production_label_at from './20261102_170000_production_label_at';

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
    up: migration_20261030_130000_oidc.up,
    down: migration_20261030_130000_oidc.down,
    name: '20261030_130000_oidc'
  },
  {
    up: migration_20261030_130000_ui_prefs.up,
    down: migration_20261030_130000_ui_prefs.down,
    name: '20261030_130000_ui_prefs'
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
    up: migration_20261030_170000_ticket_lease.up,
    down: migration_20261030_170000_ticket_lease.down,
    name: '20261030_170000_ticket_lease'
  },
  {
    up: migration_20261030_170000_watch_release_job.up,
    down: migration_20261030_170000_watch_release_job.down,
    name: '20261030_170000_watch_release_job'
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
    up: migration_20261102_150084_production_gate.up,
    down: migration_20261102_150084_production_gate.down,
    name: '20261102_150084_production_gate'
  },
  {
    up: migration_20261102_150119_gitlab_connection.up,
    down: migration_20261102_150119_gitlab_connection.down,
    name: '20261102_150119_gitlab_connection'
  },
  {
    up: migration_20261102_150138_ticket_external_unique.up,
    down: migration_20261102_150138_ticket_external_unique.down,
    name: '20261102_150138_ticket_external_unique'
  },
  {
    up: migration_20261102_150142_gate_unreachable.up,
    down: migration_20261102_150142_gate_unreachable.down,
    name: '20261102_150142_gate_unreachable'
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
    up: migration_20261102_150145_intake_sessions.up,
    down: migration_20261102_150145_intake_sessions.down,
    name: '20261102_150145_intake_sessions'
  },
  {
    up: migration_20261102_150147_media.up,
    down: migration_20261102_150147_media.down,
    name: '20261102_150147_media'
  },
  {
    up: migration_20261102_150150_knowledge.up,
    down: migration_20261102_150150_knowledge.down,
    name: '20261102_150150_knowledge'
  },
  {
    up: migration_20261102_150166_agent_keys.up,
    down: migration_20261102_150166_agent_keys.down,
    name: '20261102_150166_agent_keys'
  },
  {
    up: migration_20261102_150168_conflict_return_scope.up,
    down: migration_20261102_150168_conflict_return_scope.down,
    name: '20261102_150168_conflict_return_scope'
  },
  {
    up: migration_20261102_150170_requeue_expired_unclaimed_runs.up,
    down: migration_20261102_150170_requeue_expired_unclaimed_runs.down,
    name: '20261102_150170_requeue_expired_unclaimed_runs'
  },
  {
    up: migration_20261102_160000_production_approved_sha.up,
    down: migration_20261102_160000_production_approved_sha.down,
    name: '20261102_160000_production_approved_sha'
  },
  {
    up: migration_20261102_170000_intake_session_user.up,
    down: migration_20261102_170000_intake_session_user.down,
    name: '20261102_170000_intake_session_user'
  },
  {
    up: migration_20261102_170000_production_label_at.up,
    down: migration_20261102_170000_production_label_at.down,
    name: '20261102_170000_production_label_at'
  },
];

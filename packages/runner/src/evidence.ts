import { planStepCount } from './pre-review.js';
import type { GoalStatement, ToolCallRecord } from './types.js';

/** `## Evidence` section (pack/rules/evidence.md) assembled from recorded Bash calls and the final Goal file. */
export function buildEvidence(goal: GoalStatement[], calls: ToolCallRecord[], plan = '', extra: string[] = []): string {
  const cmds = calls.filter((c) => c.tool === 'Bash');
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = goal.map((g) => `| ${cell(g.text)} | ${g.status}${g.reason ? ` (${cell(g.reason)})` : ''} | ${g.status === 'verified' ? 'see commands' : '-'} |`);
  const cmdRows = cmds.map((c) => `| \`${cell(String((c.input as { command?: string }).command ?? '')).replace(/`/g, "'")}\` | ${c.exitCode ?? '?'} | ${c.durationMs ?? '-'} |`);
  const steps = planStepCount(plan);
  const unmet = goal.filter((g) => g.status !== 'verified');
  const unverified = unmet.map((g) => g.text);
  const step = unmet.length ? `deferred | ${cell(unmet.map((g) => g.reason ?? '').filter(Boolean).join('; ')) || '-'}` : 'done | Goal verified, see commands';
  return [
    '## Evidence',
    '| Goal statement | Status | Evidence |',
    '|---|---|---|',
    ...rows,
    '',
    ...(steps ? ['', '| Plan step | done/deferred | Evidence or reason |', '|---|---|---|', ...Array.from({ length: steps }, (_, i) => `| ${i + 1} | ${step} |`)] : []),
    '',
    '**Commands** (recorded by the Runner)',
    '| Command | Exit | ms |',
    '|---|---|---|',
    ...(cmdRows.length ? cmdRows : ['| (none) | - | - |']),
    '',
    ...extra,
    `**Not verified**: ${unverified.length ? unverified.join('; ') : 'none'}`,
  ].join('\n');
}

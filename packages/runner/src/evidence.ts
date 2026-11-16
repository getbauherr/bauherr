import { planStepCount, type ProofItem } from './pre-review.js';
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

/** The before/after table of the MR body: one row per view and variant (`<theme>-<size>: <view>` titles), before left, after right; empty without a pair. A cell is the image link when the proof has a URL, else the file name. */
export function screenshotTable(proof: ProofItem[]): string {
  const rows = new Map<string, { view: string; theme: string; size: string; before?: string; after?: string }>();
  for (const p of proof) {
    const m = p.kind === 'image' && p.pair ? /^([a-z]+)-([a-z]+):\s*(.+)$/i.exec(p.title) : null;
    if (!m) continue;
    const [, theme, size, view] = m as unknown as [string, string, string, string];
    const row = rows.get(`${view}|${theme}|${size}`) ?? { view: view.trim(), theme: theme.toLowerCase(), size: size.toLowerCase() };
    row[p.pair!] = p.url ? `![${p.title}](${p.url})` : (p.file?.name ?? p.title);
    rows.set(`${view}|${theme}|${size}`, row);
  }
  if (!rows.size) return '';
  const cell = (s?: string) => (s ?? '-').replace(/\|/g, '\\|');
  return ['## Screenshots', '| View | Theme | Size | Before | After |', '|---|---|---|---|---|', ...[...rows.values()].map((r) => `| ${cell(r.view)} | ${r.theme} | ${r.size} | ${cell(r.before)} | ${cell(r.after)} |`)].join('\n');
}

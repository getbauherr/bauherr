import { planStepCount, UI_PROOF_RULE, type ProofItem } from './pre-review.js';
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

/** The before/after table of the MR body: one row per view and variant of the UI proof rule (titles `<theme>-<size>: <view>`, parsed as loosely as the gate), before left, after right; empty without a pair. A cell is the image link when the proof has a URL, else the file name; the first image of a cell wins. */
export function screenshotTable(proof: ProofItem[]): string {
  const rows = new Map<string, { view: string; theme: string; size: string; before?: string; after?: string }>();
  const md = (s: string) => s.replace(/[\[\]|\\]/g, '\\$&').replace(/\s+/g, ' ');
  for (const p of proof) {
    const m = p.kind === 'image' && p.pair && p.rule === UI_PROOF_RULE ? /^(\p{L}+)-(\p{L}+)(?![\p{L}\p{N}_-])[^\p{L}\p{N}]*(.*)$/u.exec(p.title.trim()) : null;
    if (!m) continue;
    const theme = m[1]!.toLowerCase(), size = m[2]!.toLowerCase(), view = m[3]!.trim() || '-';
    const key = `${view}|${theme}|${size}`;
    const row = rows.get(key) ?? { view, theme, size };
    row[p.pair!] ??= p.url ? `![${md(p.title.trim())}](<${p.url.replace(/[<>\s]/g, encodeURIComponent)}>)` : md(p.file?.name ?? p.title);
    rows.set(key, row);
  }
  if (!rows.size) return '';
  return ['## Screenshots', '| View | Theme | Size | Before | After |', '|---|---|---|---|---|', ...[...rows.values()].map((r) => `| ${md(r.view)} | ${r.theme} | ${r.size} | ${r.before ?? '-'} | ${r.after ?? '-'} |`)].join('\n');
}

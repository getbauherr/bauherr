import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GoalStatement, RunCtx } from './types.js';

export const GOAL_FILE = '.bauherr/goal.json';
export const WORKLOG_FILE = '.bauherr/worklog.md';
export const PLAN_FILE = '.bauherr/plan.md';
export const REVIEW_FILE = '.bauherr/review.json';

const stripFrontmatter = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, '');

/** Writes the pack, AGENTS.md and .bauherr/* into cwd, git-excluded. Returns the AGENTS.md text. */
export function materialise(cwd: string, ctx: RunCtx): string {
  const { packDir } = ctx;
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  const skills = join(packDir, 'skills');
  if (existsSync(skills)) cpSync(skills, join(cwd, '.claude/skills'), { recursive: true, force: false }); // repo's own config wins

  const rulesDir = join(packDir, 'rules');
  const rules = existsSync(rulesDir)
    ? readdirSync(rulesDir).filter((f) => f.endsWith('.md')).sort().map((f) => stripFrontmatter(readFileSync(join(rulesDir, f), 'utf8')).trim())
    : [];

  mkdirSync(join(cwd, '.bauherr'), { recursive: true });
  const goal: GoalStatement[] = ctx.run.goal.statements.map((text) => ({ text, status: 'unverified' }));
  writeFileSync(join(cwd, GOAL_FILE), JSON.stringify(goal, null, 2));
  const worklog = ctx.ticket.worklog ?? '';
  writeFileSync(join(cwd, WORKLOG_FILE), worklog);

  const agents = [
    `# Run ${ctx.run.id} (${ctx.run.stage})`,
    `## Goal\nEach statement is checkable. Track status in \`${GOAL_FILE}\` (unverified | verified | blocked + reason).\n` +
      ctx.run.goal.statements.map((s) => `- ${s}`).join('\n'),
    `## Worklog (\`${WORKLOG_FILE}\`)\n${worklog || '(empty)'}`,
    ...(ctx.ticket.plan ? [`## Approved plan\n${ctx.ticket.plan}`] : []),
    `## Ticket #${ctx.ticket.number}: ${ctx.ticket.title}\n${ctx.ticket.url}\n\n${ctx.ticket.body}`,
    ...rules,
  ].join('\n\n');
  // A committed AGENTS.md wins; ours then lives only under .bauherr/.
  writeFileSync(join(cwd, existsSync(join(cwd, 'AGENTS.md')) ? '.bauherr/AGENTS.md' : 'AGENTS.md'), agents);

  const exclude = join(cwd, '.git/info/exclude');
  if (existsSync(join(cwd, '.git'))) {
    mkdirSync(join(cwd, '.git/info'), { recursive: true });
    appendFileSync(exclude, '\n/.bauherr/\n/.claude/\n/AGENTS.md\n');
  }
  return agents;
}

import { readFileSync } from 'node:fs';
import type { GoalStatement } from './types.js';

export function readGoal(file: string): GoalStatement[] {
  return JSON.parse(readFileSync(file, 'utf8')) as GoalStatement[];
}

export type GoalVerdict = { kind: 'ok' } | { kind: 'block'; reason: string } | { kind: 'needs_human'; reason: string };

/**
 * Stop-hook logic (#37): unverified statements block the turn once; a second miss or any
 * declared blocker ends the Run needs_human; all verified ends it succeeded.
 */
export function checkGoal(goal: GoalStatement[], alreadyBlocked: boolean): GoalVerdict {
  const unmet = goal.filter((s) => s.status === 'unverified');
  const blocked = goal.filter((s) => s.status === 'blocked');
  if (unmet.length > 0) {
    if (!alreadyBlocked) {
      return {
        kind: 'block',
        reason: `Unmet Goal statements: ${unmet.map((s) => s.text).join('; ')}. Verify each (set "status":"verified") in .bauherr/goal.json with evidence, or set "status":"blocked" with a "reason".`,
      };
    }
    return { kind: 'needs_human', reason: `Unmet Goal statements after re-prompt: ${unmet.map((s) => s.text).join('; ')}` };
  }
  if (blocked.length > 0) {
    return { kind: 'needs_human', reason: blocked.map((s) => `${s.text}: ${s.reason ?? 'blocked'}`).join('; ') };
  }
  return { kind: 'ok' };
}

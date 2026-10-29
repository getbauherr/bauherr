import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

export type Decision = { allow: true } | { allow: false; reason: string };

/** realpath of the nearest existing ancestor plus the not-yet-existing remainder. */
function realish(p: string): string {
  const rest: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return resolve(realpathSync(cur), ...rest);
    } catch {
      rest.unshift(basename(cur));
      cur = dirname(cur);
    }
  }
}

/** Port of pack/hooks/write-scope-guard.ts: writes only inside cwd (symlinks resolved), and inside owned paths when set. */
export function writeScopeGuard(cwd: string, filePath: string | undefined, owned: string[] = []): Decision {
  const target = realish(resolve(cwd, filePath ?? ''));
  const rel = relative(realpathSync(cwd), target);
  if (rel.startsWith('..') || isAbsolute(rel)) return { allow: false, reason: 'path outside the Run\'s cwd' };
  if (rel === '.git' || rel.startsWith('.git/')) return { allow: false, reason: 'writes to .git are not allowed' };
  if (owned.length > 0 && !owned.some((p) => rel === p || rel.startsWith(p.replace(/\*+$/, '')))) {
    return { allow: false, reason: 'path outside this lane\'s owned paths' };
  }
  return { allow: true };
}

const NETWORK = /(^|[ ;|&])(curl|wget|nc|ssh|scp|git\s+(push|clone|fetch|pull))( |$)/;

/** Port of pack/hooks/egress-guard.sh. A guide, not a security boundary. */
export function egressGuard(tool: string, input: { command?: string; url?: string }, gatewayHost: string): Decision {
  if (tool === 'WebFetch' || tool === 'WebSearch') {
    return { allow: false, reason: 'network tools are disabled; egress only via the gateway' };
  }
  const cmd = input.command ?? input.url ?? '';
  if (NETWORK.test(cmd) && !cmd.includes(gatewayHost)) {
    return { allow: false, reason: 'network access only to the gateway; see rules/egress.md' };
  }
  return { allow: true };
}

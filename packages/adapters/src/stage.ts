import type { TicketSource } from './contracts.js';

const STAGE = 'bauherr:stage:';
export const APPROVED_PLAN = 'bauherr:approved:plan';
export const stageLabel = (name: string): string => STAGE + name;
export const closeReasonLabel = (reason: string): string => `bauherr:close-reason:${reason}`;
/** The stage label's name; with two known stage labels (a half-finished move) the one later in `order` wins. */
export const stageOf = (labels: string[], order: readonly string[]): string | null => {
  const names = labels.filter((l) => l.startsWith(STAGE)).map((l) => l.slice(STAGE.length));
  const known = names.filter((n) => order.includes(n));
  return known.length > 1 ? known.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a)) : (names[0] ?? null);
};

/** One stage label per ticket: adds the new one first, then removes the others, so a failed call never leaves none. */
export async function setStage(ts: TicketSource, id: string, name: string): Promise<void> {
  const next = stageLabel(name);
  const { labels } = await ts.get(id);
  const stale = labels.filter((l) => l.startsWith(STAGE) && l !== next);
  if (!labels.includes(next)) await ts.addLabels(id, [next]);
  if (stale.length) await ts.removeLabels(id, stale);
}

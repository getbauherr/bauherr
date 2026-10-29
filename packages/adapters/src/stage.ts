import type { TicketSource } from './contracts.js';

const STAGE = 'bauherr:stage:';
export const APPROVED_PLAN = 'bauherr:approved:plan';
export const stageLabel = (name: string): string => STAGE + name;
export const closeReasonLabel = (reason: string): string => `bauherr:close-reason:${reason}`;
export const stageOf = (labels: string[]): string | null =>
  labels.find((l) => l.startsWith(STAGE))?.slice(STAGE.length) ?? null;

/** Exactly one stage label per ticket: removes other stage labels, adds the new one. */
export async function setStage(ts: TicketSource, id: string, name: string): Promise<void> {
  const next = stageLabel(name);
  const { labels } = await ts.get(id);
  const stale = labels.filter((l) => l.startsWith(STAGE) && l !== next);
  if (stale.length) await ts.removeLabels(id, stale);
  if (!labels.includes(next)) await ts.addLabels(id, [next]);
}

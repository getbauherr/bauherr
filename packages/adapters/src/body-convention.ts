export const RELATIONS_START = '<!-- bauherr:relations -->';
export const RELATIONS_END = '<!-- /bauherr:relations -->';

export interface Relations {
  parent: string | null;
  blockedBy: string[];
  links: string[];
}
export const noRelations = (): Relations => ({ parent: null, blockedBy: [], links: [] });

const BLOCK = new RegExp(`\\n*${RELATIONS_START}([\\s\\S]*?)${RELATIONS_END}\\s*$`);

/** Splits a stored body into the user-visible body and the relations block. */
export function parseRelations(stored: string): { body: string; relations: Relations } {
  const m = BLOCK.exec(stored);
  if (!m) return { body: stored, relations: noRelations() };
  const relations = noRelations();
  for (const line of (m[1] ?? '').split('\n')) {
    const l = /^\s*(Parent|Blocked by|Link):\s*(.+?)\s*$/.exec(line);
    if (!l?.[1] || !l[2]) continue;
    const value = l[2].replace(/^#/, '');
    if (l[1] === 'Parent') relations.parent = value;
    else if (l[1] === 'Blocked by') relations.blockedBy.push(value);
    else relations.links.push(l[2]);
  }
  return { body: stored.slice(0, m.index), relations };
}

/** Appends the relations block to `body`; no block when there are no relations. */
export function renderRelations(body: string, r: Relations): string {
  const lines = [
    ...(r.parent ? [`Parent: #${r.parent}`] : []),
    ...r.blockedBy.map((b) => `Blocked by: #${b}`),
    ...r.links.map((u) => `Link: ${u}`),
  ];
  const clean = parseRelations(body).body;
  return lines.length ? `${clean}\n\n${RELATIONS_START}\n${lines.join('\n')}\n${RELATIONS_END}` : clean;
}

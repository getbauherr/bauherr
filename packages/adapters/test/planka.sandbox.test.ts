import { it } from 'node:test';
import { FakeBackend, PlankaTicketSource, withTickets } from '../src/index.js';
import { contractSuite } from './contract.js';

const { PLANKA_TOKEN: token, PLANKA_BASE_URL: baseUrl, PLANKA_SANDBOX_BOARD: boardId } = process.env;

if (!token || !baseUrl || !boardId) {
  it.skip('planka sandbox: set PLANKA_TOKEN, PLANKA_BASE_URL and PLANKA_SANDBOX_BOARD (a throwaway board with a "Done" list and the token user as member)', () => {});
} else {
  const api = (method: string, path: string) => fetch(`${baseUrl.replace(/\/+$/, '')}/api${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const source = new PlankaTicketSource({ baseUrl, token, boardId });

  contractSuite('planka sandbox', {
    backend: withTickets(new FakeBackend(), source), repo: boardId, user: (await source.whoami())!, ticketsOnly: true,
    commitFile: async () => {},
    async cleanup({ tickets, labels }) {
      const { included } = (await (await api('GET', `/boards/${boardId}`)).json()) as { included: { cards: any[]; labels: any[] } };
      const made = new Set(tickets);
      for (const c of included.cards) {
        if (made.has(/Number: (\d+)/.exec(c.description ?? '')?.[1] ?? '')) await api('DELETE', `/cards/${c.id}`);
      }
      const names = new Set([...labels, 'bauherr:test', 'bauherr:a', 'bauherr:b', 'keep', 'bauherr:approved:plan']);
      for (const l of included.labels) {
        if (names.has(l.name) || /^bauherr:(stage|close-reason):/.test(l.name)) await api('DELETE', `/labels/${l.id}`);
      }
    },
  });
}

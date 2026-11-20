import { readFileSync } from 'node:fs';
import { GitlabBackend, gitlabPat } from '../src/index.js';
import type { Wire } from '../src/wire.js';
import { bodyOf, json, urlOf } from './helpers.js';

export const fx = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../test/fixtures/gitlab/${name}.json`, import.meta.url), 'utf8'));
export const fxObject = (name: string): Wire => fx(name) as Wire;
export const API = 'https://gitlab.test/api/v4';
export const P = '/projects/g%2Fp';

export type Call = { method: string; path: string; body: Wire | undefined; token: string | null };

export const setup = (
  handler: (method: string, path: string, body: Wire | undefined) => unknown,
  sleeps: number[] = [],
) => {
  const calls: Call[] = [];
  const b = new GitlabBackend({
    auth: gitlabPat('tok'),
    baseUrl: 'https://gitlab.test/',
    sleep: async (ms) => void sleeps.push(ms),
    fetch: async (u, init) => {
      const path = urlOf(u).slice(API.length);
      const body = bodyOf(init);
      calls.push({ method: init?.method ?? 'GET', path, body, token: new Headers(init?.headers).get('private-token') });
      const r = handler(init?.method ?? 'GET', path, body);
      return r instanceof Response ? r : json(r);
    },
  });
  return { b, calls, ts: b.tickets('g/p'), forge: b.forge };
};

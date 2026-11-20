import type { Wire } from '../src/wire.js';

export const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

export const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

export const bodyOf = (init?: RequestInit): Wire | undefined =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as Wire) : undefined;

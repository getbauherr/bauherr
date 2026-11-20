export type Wire = Record<string, unknown>;

export const wire = (value: unknown): Wire =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
export const text = (value: unknown): string => (typeof value === 'string' ? value : '');
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const field = (value: unknown, key: string): string => text(wire(value)[key]);
export const get = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((at, key) => wire(at)[key], value);
export const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
export const flag = (value: unknown): boolean => value === true;
export const maybeText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
export const nullableText = (value: unknown): string | null => (typeof value === 'string' ? value : null);
export const idText = (value: unknown): string =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : '';
export const labelName = (label: unknown): string => (typeof label === 'string' ? label : field(label, 'name'));

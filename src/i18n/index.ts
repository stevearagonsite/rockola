import { en } from './en.js';
import { es, type MessageKey } from './es.js';

export type Locale = 'es' | 'en';
export type { MessageKey };
export const LOCALES: readonly Locale[] = ['es', 'en'];

const dictionaries: Record<Locale, Record<MessageKey, string>> = { es, en };

export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = dictionaries[locale]?.[key] ?? es[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function isLocale(value: unknown): value is Locale {
  return value === 'es' || value === 'en';
}

import en from './locales/en';
import ja from './locales/ja';
import zhHans, { type MessageKey } from './locales/zh-Hans';
import zhHant from './locales/zh-Hant';

export type { MessageKey };

export type Locale = 'zh-Hans' | 'zh-Hant' | 'en' | 'ja';

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

export const DEFAULT_LOCALE: Locale = 'zh-Hans';

const dicts: Record<Locale, Record<MessageKey, string>> = {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  en,
  ja,
};

export function normalizeLocale(locale: string | undefined | null): Locale {
  if (locale && locale in dicts) return locale as Locale;
  return DEFAULT_LOCALE;
}

export function t(locale: Locale, key: MessageKey): string {
  return dicts[locale][key];
}

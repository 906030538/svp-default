import { SITE_NAME } from '@/config';
import { normalizeLocale, t, type Locale, type MessageKey } from '@/i18n';

/** 语言偏好保存在 localStorage，不体现在路由中；页面静态壳以默认语言渲染，客户端按偏好重译 */
export const LOCALE_STORAGE_KEY = 'svp-locale';

export function getClientLocale(): Locale {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return normalizeLocale(undefined);
  }
}

export function setClientLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

function translate(key: string | undefined): string | null {
  return key ? t(getClientLocale(), key as MessageKey) : null;
}

/** 按当前语言偏好重译页面：html lang、data-i18n 文本、占位符、aria 标签、语言下拉与页面标题 */
export function applyClientLocale(): void {
  const locale = getClientLocale();
  document.documentElement.lang = locale;
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const text = translate(el.dataset.i18n);
    if (text !== null) el.textContent = text;
  }
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) {
    const text = translate(el.dataset.i18nPh);
    if (text !== null) el.placeholder = text;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const text = translate(el.dataset.i18nAria);
    if (text !== null) el.setAttribute('aria-label', text);
  }
  const switcher = document.querySelector<HTMLSelectElement>('#lang-switcher');
  if (switcher) switcher.value = locale;
  const title = document.querySelector('title');
  const titleText = translate(title?.dataset.i18n);
  if (titleText !== null) document.title = `${titleText} - ${SITE_NAME}`;
}

import { SITE_NAME } from '@/config';
import { t, type Locale } from '@/i18n';
import { pageBase } from '@/lib/base';
import { applyClientLocale, getClientLocale } from '@/lib/i18n-client';
import { loadLivePost } from '@/lib/live-core';
import { getSource, type SourceConfig } from '@/lib/remote';
import { detailHtml, esc } from '@/lib/viewgen';

/**
 * hash 实时视图（#/post/{slug}）：BaseLayout 路由器按需动态加载本模块，
 * 从内容仓拉取最新数据渲染稿件详情。未重新部署的新稿件由此可访问。
 */

let renderToken = 0;

function stateCard(locale: Locale, inner: string): string {
  return `<article class="mx-auto w-full max-w-3xl"><div class="card p-6 text-center text-sm">${inner}
    <div class="mt-4"><a href="${esc(listHref())}" class="btn" data-i18n="detail.back">← ${esc(t(locale, 'detail.back'))}</a></div>
  </div></article>`;
}

/** 返回链接：已在列表页则清 hash 原地返回，否则跳列表页路径。
 *  列表页判定用 DOM（是否存在构建期详情容器）而非 pathname——file:// 下
 *  pathname 是文件系统路径，无法与站点根比对。 */
function listHref(): string {
  if (!document.querySelector('[data-role="post-detail"]')) return '#/';
  return pageBase('/') || '/';
}

function bindRetry(container: HTMLElement, slug: string): void {
  container.querySelector<HTMLButtonElement>('[data-role="live-retry"]')?.addEventListener('click', () => {
    void renderLive(container, slug);
  });
}

export async function renderLive(container: HTMLElement, slug: string): Promise<void> {
  const token = ++renderToken;
  const locale = getClientLocale();
  const source: SourceConfig | null = getSource();
  container.hidden = false;
  window.scrollTo(0, 0);
  if (!source) {
    container.innerHTML = stateCard(locale, `<p data-i18n="live.error">${esc(t(locale, 'live.error'))}</p>`);
    return;
  }
  container.innerHTML = stateCard(
    locale,
    `<p class="text-slate-500 dark:text-slate-400" data-i18n="live.loading">${esc(t(locale, 'live.loading'))}</p>`,
  );
  try {
    const result = await loadLivePost(source, slug, { backHref: listHref() });
    if (token !== renderToken) return; // 期间已切换到其他路由
    if (result.status === 'notfound') {
      container.innerHTML = stateCard(
        locale,
        `<p data-i18n="live.notFound">${esc(t(locale, 'live.notFound'))}</p>`,
      );
    } else {
      container.innerHTML = detailHtml(result.view, { locale });
      applyClientLocale();
      document.title = `${result.entry.title} - ${SITE_NAME}`;
    }
  } catch {
    if (token !== renderToken) return;
    const localeNow = getClientLocale();
    container.innerHTML = stateCard(
      localeNow,
      `<p data-i18n="live.error">${esc(t(localeNow, 'live.error'))}</p>
       <button type="button" class="btn mt-3" data-role="live-retry" data-i18n="live.retry">${esc(t(localeNow, 'live.retry'))}</button>`,
    );
    bindRetry(container, slug);
  }
}

export function clearLive(container: HTMLElement): void {
  renderToken++;
  container.innerHTML = '';
  container.hidden = true;
}

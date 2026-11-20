import { t, type Locale } from '@/i18n';
import { mediaKind, parseAttrList, type MediaItem, type ParsedReadme, type ProjectFile } from '@/lib/content';
import type { SubmissionEntry } from '@/types';

/**
 * 共享视图生成器（构建期 SSG 与运行时实时视图的唯一标记源）。
 * .astro 页面经 set:html 消费，客户端脚本（hash 实时视图 / 列表刷新 / 详情热替换）
 * 经 innerHTML 消费——两侧标记天然一致，不会漂移。
 *
 * 安全口径：所有插值必须经 esc()；外链必须经 safeHttpUrl()（README 的
 * videos 等属性是投稿者可控输入，旧版 SSG 直接透传 href 存在 javascript:
 * 注入面，本生成器统一收口）。
 */

/** HTML 文本/属性转义 */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** URL 路径段编码（CJK slug / 含空格文件名） */
export function encSeg(segment: string): string {
  return encodeURIComponent(segment);
}

/** 仅放行 http(s) 绝对链接（外链输入可控，防 javascript: 等协议注入） */
export function safeHttpUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

export function fmtDate(iso: string | undefined, locale: Locale): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 展示字段签名（卡片 + 详情页全部展示字段的稳定序列化）：构建期与远端比对，判定是否需要刷新 */
const SIG_FIELDS = [
  'type',
  'title',
  'cover',
  'submittedAt',
  'publishedAt',
  'paramState',
  'songs',
  'engines',
  'voicebanks',
  'languages',
  'tags',
  'owner',
] as const;

export function entrySig(entry: SubmissionEntry): string {
  return JSON.stringify(SIG_FIELDS.map((field) => entry[field] ?? null));
}

/** 媒体区分流（与主站 loadSubmissionContent 同口径）：明文媒体类进媒体区，压缩/加密工程文件与 other 类不进 */
export function buildMediaItems(
  dirFiles: string[],
  parsed: ParsedReadme,
  urlFor: (name: string) => string,
): MediaItem[] {
  const fileSet = new Map(parsed.files.map((f) => [f.name, f] as const));
  return dirFiles
    .filter((name) => {
      const file = fileSet.get(name);
      return !file || (!file.compressed && !file.encrypted && mediaKind(name) !== 'other');
    })
    .map((name) => ({ name, kind: mediaKind(name), url: urlFor(name) }));
}

// ---------------- 集合页卡片 ----------------

function paramsChipLabel(entry: SubmissionEntry, locale: Locale): string | null {
  if (entry.type !== 'project') return null;
  return entry.paramState === 'with-params'
    ? t(locale, 'params.with')
    : entry.paramState === 'tuned'
      ? t(locale, 'params.tuned')
      : t(locale, 'params.none');
}

export interface CardOptions {
  locale: Locale;
  href: string;
  coverUrl: string | null;
}

export function cardHtml(entry: SubmissionEntry, opts: CardOptions): string {
  const { locale } = opts;
  const chips = [
    ...(entry.songs ?? []).map((v) => `♪ ${v}`),
    ...(entry.engines ?? []),
    ...(entry.voicebanks ?? []),
    ...(entry.languages ?? []),
  ];
  const params = paramsChipLabel(entry, locale);
  const cover = opts.coverUrl
    ? `<a href="${esc(opts.href)}" class="block w-32 shrink-0"><img src="${esc(opts.coverUrl)}" alt="${esc(entry.title)}" class="aspect-video w-full rounded-lg object-cover" loading="lazy" /></a>`
    : '';
  return `<article class="card flex gap-4 p-4">${cover}<div class="min-w-0 flex-1"><h3 class="truncate font-medium"><a href="${esc(opts.href)}" class="hover:text-emerald-600 dark:hover:text-emerald-400">${esc(entry.title)}</a></h3><p class="mt-1 text-sm text-slate-500 dark:text-slate-400"><time datetime="${esc(entry.submittedAt ?? '')}">${esc(fmtDate(entry.submittedAt, locale))}</time></p><div class="mt-2 flex flex-wrap gap-1.5">${chips.map((v) => `<span class="chip">${esc(v)}</span>`).join('')}${params ? `<span class="chip font-medium text-emerald-600 dark:text-emerald-400">${esc(params)}</span>` : ''}</div></div></article>`;
}

export function listHtml(
  entries: SubmissionEntry[],
  opts: { locale: Locale; hrefFor: (entry: SubmissionEntry) => string; coverFor: (entry: SubmissionEntry) => string | null },
): string {
  const cards = entries.map((entry) =>
    cardHtml(entry, { locale: opts.locale, href: opts.hrefFor(entry), coverUrl: opts.coverFor(entry) }),
  );
  if (!cards.length) {
    return `<p class="py-8 text-center text-sm text-slate-400 dark:text-slate-500" data-i18n="common.noResults">${esc(t(opts.locale, 'common.noResults'))}</p>`;
  }
  return cards.join('');
}

// ---------------- 稿件详情 ----------------

export interface DetailViewData {
  entry: SubmissionEntry;
  parsed: ParsedReadme;
  bodyHtml: string;
  /** 封面地址（null=无封面） */
  coverUrl: string | null;
  media: MediaItem[];
  licenseId: string | null;
  sourceRepoUrl: string;
  backHref: string;
  /** 目录内文件 URL（构建期=站点内路径，运行时=平台 raw 直链） */
  fileUrl: (name: string) => string;
}

export function detailHtml(data: DetailViewData, opts: { locale: Locale; updatedChip?: boolean }): string {
  const { entry, parsed, media } = data;
  const { locale } = opts;

  const typeChip = entry.type === 'project' ? t(locale, 'type.project') : t(locale, 'type.article');
  const paramsChip = paramsChipLabel(entry, locale);
  const songList = parseAttrList(parsed.attrs.songs);
  const engineList = parseAttrList(parsed.attrs.engines);
  const voicebankList = parseAttrList(parsed.attrs.voicebanks);
  const languageList = parseAttrList(parsed.attrs.languages);
  const tagList = parseAttrList(parsed.attrs.tags);
  const videoList = parseAttrList(parsed.attrs.videos)
    .map(safeHttpUrl)
    .filter((url): url is string => url !== null);

  const metaRows: { label: string; value: string }[] = [
    ...(songList.length ? [{ label: t(locale, 'label.tracks'), value: songList.join(' / ') }] : []),
    ...(engineList.length ? [{ label: t(locale, 'label.engines'), value: engineList.join(' / ') }] : []),
    ...(voicebankList.length ? [{ label: t(locale, 'label.voicebanks'), value: voicebankList.join(' / ') }] : []),
    ...(languageList.length ? [{ label: t(locale, 'label.songLanguages'), value: languageList.join(' / ') }] : []),
  ];

  const images = media.filter((m) => m.kind === 'image');
  const audios = media.filter((m) => m.kind === 'audio');
  const videos = media.filter((m) => m.kind === 'video');

  return `<article class="mx-auto w-full max-w-3xl">
    <header>
      <h1 class="text-3xl font-bold">${esc(entry.title)}</h1>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span class="chip">${esc(typeChip)}</span>
        ${paramsChip ? `<span class="chip">${esc(paramsChip)}</span>` : ''}
        <time class="text-slate-500 dark:text-slate-400" datetime="${esc(entry.publishedAt ?? entry.submittedAt ?? '')}">${esc(fmtDate(entry.publishedAt ?? entry.submittedAt, locale))}</time>
        ${opts.updatedChip ? `<span class="chip font-medium text-emerald-600 dark:text-emerald-400" data-i18n="live.updated">${esc(t(locale, 'live.updated'))}</span>` : ''}
      </div>
    </header>

    ${data.coverUrl ? `<figure class="mt-4"><img src="${esc(data.coverUrl)}" alt="${esc(entry.title)}" class="aspect-video w-full max-w-xl rounded-xl object-cover" /></figure>` : ''}

    ${metaRows.length ? `<dl class="card mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-sm">${metaRows.map((row) => `<dt class="text-slate-500 dark:text-slate-400">${esc(row.label)}</dt><dd>${esc(row.value)}</dd>`).join('')}</dl>` : ''}

    ${videoList.length ? `<section class="card mt-4 p-4"><h2 class="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400" data-i18n="label.videos">${esc(t(locale, 'label.videos'))}</h2><ul class="flex flex-wrap gap-2">${videoList.map((url) => `<li><a href="${esc(url)}" target="_blank" rel="noopener" class="btn">${esc(url)}</a></li>`).join('')}</ul></section>` : ''}

    ${media.length ? `<section class="card mt-4 p-4"><h2 class="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400" data-i18n="detail.media">${esc(t(locale, 'detail.media'))}</h2><div class="grid grid-cols-2 gap-3 sm:grid-cols-3">${images.map((m) => `<a href="${esc(m.url)}" target="_blank" rel="noopener"><img src="${esc(m.url)}" alt="${esc(m.name)}" class="aspect-video w-full rounded-lg object-cover" loading="lazy" /></a>`).join('')}</div><div class="mt-3 flex flex-col gap-3">${audios.map((m) => `<figure><figcaption class="mb-1 truncate text-xs text-slate-500 dark:text-slate-400">${esc(m.name)}</figcaption><audio controls preload="none" src="${esc(m.url)}" class="w-full"></audio></figure>`).join('')}</div><div class="mt-3 grid gap-3">${videos.map((m) => `<video controls preload="metadata" src="${esc(m.url)}" class="w-full rounded-lg"></video>`).join('')}</div></section>` : ''}

    <section class="prose-svp mt-6" data-role="body"><div class="svp-md">${data.bodyHtml}</div></section>

    ${tagList.length ? `<section class="mt-6 flex flex-wrap gap-1.5">${tagList.map((tag) => `<span class="chip">#${esc(tag)}</span>`).join('')}</section>` : ''}

    ${parsed.files.length ? `<section class="card mt-6 p-4"><h2 class="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400" data-i18n="detail.files">${esc(t(locale, 'detail.files'))}</h2><ul class="flex flex-col gap-1.5">${parsed.files.map((f: ProjectFile) => `<li><a href="${esc(data.fileUrl(f.name))}" class="hover:text-emerald-600 dark:hover:text-emerald-400" download>${f.encrypted ? '🔒' : f.compressed ? '🗜' : '📄'} ${esc(f.name)}</a></li>`).join('')}</ul></section>` : ''}

    <aside class="card mt-6 p-4">
      <h2 class="mb-3 text-sm font-semibold text-slate-500 dark:text-slate-400" data-i18n="label.user">${esc(t(locale, 'label.user'))}</h2>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="font-medium">${esc(entry.owner)}</span>
        <a href="${esc(data.sourceRepoUrl)}" target="_blank" rel="noopener" class="btn" data-i18n="detail.sourceRepo">${esc(t(locale, 'detail.sourceRepo'))}</a>
        ${data.licenseId ? `<span class="text-slate-500 dark:text-slate-400"><span data-i18n="label.license">${esc(t(locale, 'label.license'))}</span>：${esc(data.licenseId)}</span>` : ''}
      </div>
    </aside>

    <nav class="mt-8 flex justify-between text-sm">
      <a href="${esc(data.backHref)}" class="btn" data-i18n="detail.back">← ${esc(t(locale, 'detail.back'))}</a>
    </nav>
  </article>`;
}

/** 详情页封面地址（构建期口径）：绝对 http(s) 原样，文件名走站点内部署路径 */
export function buildCoverUrl(entry: SubmissionEntry, baseUrl: (path: string) => string): string | null {
  if (!entry.cover) return null;
  if (safeHttpUrl(entry.cover)) return entry.cover;
  return baseUrl(`/posts/${encSeg(entry.slug)}/${encSeg(entry.cover)}`);
}

import { entryFromAttrs, parseReadme } from '@/lib/content';
import { renderMarkdown } from '@/lib/markdown';
import {
  fetchArchive,
  fetchDirList,
  fetchLicenseText,
  fetchReadme,
  rawFileUrl,
  RemoteNotFoundError,
  sourceRepoPageUrl,
  type SourceConfig,
} from '@/lib/remote';
import { buildMediaItems, safeHttpUrl, type DetailViewData } from '@/lib/viewgen';
import { identifyLicenseText } from '@/lib/utils';
import type { SubmissionEntry } from '@/types';

/**
 * 运行时稿件装载：远端 archive 条目 + README + 目录清单 + LICENSE → 详情视图数据。
 * 供 hash 实时视图（live.ts）与详情页热替换（freshness）共用；archive/readme
 * 支持预取透传，避免同页两次拉取。
 */

export type LivePostResult =
  | { status: 'ok'; view: DetailViewData; entry: SubmissionEntry }
  | { status: 'notfound' };

export interface LoadLivePostOptions {
  /** 预取的远端索引（null=拉取失败） */
  archive?: SubmissionEntry[] | null;
  /** 预取的 README 原文 */
  readme?: string;
  /** 远端索引缺失该 slug 时的回退条目（详情页热替换用构建期条目，兼容索引滞后场景） */
  fallbackEntry?: SubmissionEntry;
  /** 返回链接（列表页路径；缺省由调用方渲染后自行覆盖） */
  backHref?: string;
}

export async function loadLivePost(
  source: SourceConfig,
  slug: string,
  opts: LoadLivePostOptions = {},
): Promise<LivePostResult> {
  // 判定顺序：README 是稿件存在性的唯一事实源——404 = 已移除；拉取失败（网络）
  // 上抛由调用方兜底。索引（archive）仅提供元数据，不可用不阻断渲染：
  // 实测 raw 端点随机断连窗口内 archive 失败而 README 可达，若以 archive 缺条目
  // 判 notfound 会把活稿误报成「未找到」。
  let raw = opts.readme;
  if (raw === undefined) {
    try {
      raw = await fetchReadme(source, slug);
    } catch (error) {
      if (error instanceof RemoteNotFoundError) return { status: 'notfound' };
      throw error;
    }
  }
  if (raw === null) return { status: 'notfound' };

  const parsed = parseReadme(raw);

  const archive = opts.archive !== undefined ? opts.archive : await fetchArchive(source).catch(() => null);
  let entry = archive?.find((e) => e.slug === slug) ?? opts.fallbackEntry ?? null;
  if (!entry) {
    // 索引不可用但 README 存在：从 README 属性行回填最小展示条目
    // （映射与构建期目录扫描兜底共用 entryFromAttrs，单一事实源）
    entry = entryFromAttrs(slug, parsed.attrs, source);
  }

  const [bodyHtml, dirFiles, licenseText] = await Promise.all([
    renderMarkdown(parsed.body),
    fetchDirList(source, `posts/${slug}`),
    fetchLicenseText(source),
  ]);
  const licenseId = licenseText ? await identifyLicenseText(licenseText).catch(() => null) : null;

  const fileUrl = (name: string): string => rawFileUrl(source, `posts/${slug}/${name}`);
  const cover = entry.cover
    ? safeHttpUrl(entry.cover) ?? fileUrl(entry.cover)
    : null;

  const view: DetailViewData = {
    entry,
    parsed,
    bodyHtml,
    coverUrl: cover,
    media: buildMediaItems(dirFiles, parsed, fileUrl),
    licenseId,
    sourceRepoUrl: sourceRepoPageUrl(source),
    backHref: opts.backHref ?? '',
    fileUrl,
  };
  return { status: 'ok', view, entry };
}

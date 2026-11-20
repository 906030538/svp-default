import { PLATFORM_URLS } from '@/config';
import type { Platform, SubmissionEntry } from '@/types';
import { fetchGetTimeout } from '@/lib/utils';

/**
 * 客户端运行时取数：未重新部署时从 git 平台匿名拉取最新内容。
 *
 * 端点选型（2026-11-04 三平台真实仓库带 Origin 实测）：
 * - GitHub  raw.githubusercontent.com → ACAO:*，文本直取，无 API 限额；
 * - Gitee   raw 端点为 302 签名跳转且响应链缺 ACAO → 文本走 api/v5 contents（ACAO:*）；
 * - AtomGit raw 端点返回反爬 HTML 壳且无 CORS 头 → 文本走 api.atomgit.com/api/v5 contents（ACAO 回显）。
 * 目录列举三平台均走 contents API（与主站适配器同构）。
 * 媒体/工程文件 URL 走各平台 raw 直链（<img>/<audio> 等元素加载不要求 CORS，
 * 与主站 rawUrl 生产口径一致）。
 * 仅支持公开仓库（匿名）；私有仓需自行部署带鉴权的取数层，不在本模板范围。
 */

export interface SourceConfig {
  owner: string;
  repo: string;
  platform: Platform;
}

/** 文本读取端点：github 走 raw，gitee/atomgit 走 contents API（base64） */
const RAW_TEXT_BASES: Partial<Record<Platform, string>> = {
  github: 'https://raw.githubusercontent.com',
};

/** contents API 基址（文本回退 + 目录列举） */
const API_BASES: Record<Platform, string> = {
  github: 'https://api.github.com',
  gitee: 'https://gitee.com/api/v5',
  atomgit: 'https://api.atomgit.com/api/v5',
};

/** 平台 web 域（媒体 raw 直链与「查看源仓库」外链的基座） */
const WEB_BASES: Record<Platform, string> = {
  github: 'https://github.com',
  gitee: 'https://gitee.com',
  atomgit: 'https://atomgit.com',
};

/** 路径段逐一编码（slug 含 CJK；空格等特殊字符同样安全化） */
function encSeg(segment: string): string {
  return encodeURIComponent(segment);
}

/** 远端文件不存在（404）：调用方据此区分「已移除」与「网络失败」 */
export class RemoteNotFoundError extends Error {
  constructor(path: string) {
    super(`remote not found: ${path}`);
    this.name = 'RemoteNotFoundError';
  }
}

/** 读取构建期注入的内容仓坐标（BaseLayout #svp-source）；缺失返回 null，运行时层整体停用 */
export function getSource(): SourceConfig | null {
  const el = document.getElementById('svp-source');
  if (!el) return null;
  try {
    const cfg = JSON.parse(el.textContent ?? '') as Partial<SourceConfig>;
    if (!cfg.owner || !cfg.repo) return null;
    const platform = (['github', 'gitee', 'atomgit'] as string[]).includes(cfg.platform ?? '')
      ? (cfg.platform as Platform)
      : 'github';
    return { owner: cfg.owner, repo: cfg.repo, platform };
  } catch {
    return null;
  }
}

function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** contents API 响应解析：文件（base64）或目录（条目数组） */
async function contentsRequest(source: SourceConfig, path: string): Promise<unknown> {
  const { owner, repo, platform } = source;
  const segs = path.split('/').map(encSeg).join('/');
  const url = `${API_BASES[platform]}/repos/${encSeg(owner)}/${encSeg(repo)}/contents/${segs}`;
  const response = await fetchGetTimeout(url, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) throw new RemoteNotFoundError(path);
  if (!response.ok) throw new Error(`contents ${path}: HTTP ${response.status}`);
  return response.json();
}

/** 拉取单文件文本（svp-archive.json / README.md / LICENSE） */
export async function fetchText(source: SourceConfig, path: string): Promise<string> {
  const rawBase = RAW_TEXT_BASES[source.platform];
  if (rawBase) {
    const segs = path.split('/').map(encSeg).join('/');
    const url = `${rawBase}/${encSeg(source.owner)}/${encSeg(source.repo)}/HEAD/${segs}`;
    const response = await fetchGetTimeout(url);
    if (response.status === 404) throw new RemoteNotFoundError(path);
    if (!response.ok) throw new Error(`raw ${path}: HTTP ${response.status}`);
    return response.text();
  }
  const data = (await contentsRequest(source, path)) as { type?: string; content?: string };
  if (data.type !== 'file' || typeof data.content !== 'string') {
    throw new Error(`not a file: ${path}`);
  }
  return decodeBase64Utf8(data.content.replace(/\n/g, ''));
}

/** 列举目录内文件名（含子目录名，供分流判断；与构建期 listSubmissionFiles 同口径去 README.md） */
export async function fetchDirList(source: SourceConfig, dir: string): Promise<string[]> {
  const data = await contentsRequest(source, dir);
  if (!Array.isArray(data)) throw new Error(`not a dir: ${dir}`);
  return data
    .map((item) => (item as { name?: string }).name)
    .filter((name): name is string => !!name && name !== 'README.md');
}

interface LocalArchive {
  submissions: SubmissionEntry[];
}

let archivePromise: Promise<SubmissionEntry[] | null> | null = null;

/** 最新稿件索引（svp-archive.json）；页面级记忆化，失败不缓存以便下次重试 */
export function fetchArchive(source: SourceConfig): Promise<SubmissionEntry[] | null> {
  if (!archivePromise) {
    archivePromise = fetchText(source, 'svp-archive.json')
      .then((text) => {
        const parsed = JSON.parse(text) as LocalArchive;
        return Array.isArray(parsed.submissions) ? parsed.submissions : null;
      })
      .catch(() => {
        archivePromise = null; // 失败不缓存
        return null;
      });
  }
  return archivePromise;
}

/** 单篇稿件 README 原文（404 抛 RemoteNotFoundError） */
export function fetchReadme(source: SourceConfig, slug: string): Promise<string> {
  return fetchText(source, `posts/${slug}/README.md`);
}

let licensePromise: Promise<string | null> | null = null;

/** 仓库 LICENSE 原文（用于运行时指纹识别）；缺失/失败返回 null 不缓存失败以外的情况由调用方兜底 */
export function fetchLicenseText(source: SourceConfig): Promise<string | null> {
  if (!licensePromise) {
    licensePromise = fetchText(source, 'LICENSE').catch((error) => {
      if (error instanceof RemoteNotFoundError) return null; // 无 LICENSE 是合法状态，缓存之
      licensePromise = null; // 网络类失败可重试
      return null;
    });
  }
  return licensePromise;
}

/** 平台 raw 直链（媒体/工程文件；元素加载与下载跳转，无 CORS 要求） */
export function rawFileUrl(source: SourceConfig, path: string): string {
  const { owner, repo, platform } = source;
  const segs = path.split('/').map(encSeg).join('/');
  if (platform === 'github') {
    return `https://raw.githubusercontent.com/${encSeg(owner)}/${encSeg(repo)}/HEAD/${segs}`;
  }
  return `${WEB_BASES[platform]}/${encSeg(owner)}/${encSeg(repo)}/raw/HEAD/${segs}`;
}

/** 「查看源仓库」外链（客户端版；lib/site 的 node 实现不可进浏览器包） */
export function sourceRepoPageUrl(source: SourceConfig): string {
  return `${PLATFORM_URLS[source.platform]}/${encSeg(source.owner)}/${encSeg(source.repo)}`;
}

/** 运行时封面地址：绝对 URL 原样，文件名走仓库 raw 直链 */
export function remoteCoverUrl(source: SourceConfig, entry: SubmissionEntry): string | null {
  if (!entry.cover) return null;
  if (/^https?:\/\//i.test(entry.cover)) return entry.cover;
  return rawFileUrl(source, `posts/${entry.slug}/${entry.cover}`);
}

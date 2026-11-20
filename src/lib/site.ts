import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_PLATFORMS, PLATFORM_URLS } from '@/config';
import type { Platform } from '@/types';

/**
 * 独立站上下文：当前内容仓的平台坐标与站点元数据。
 * 解析优先级：CI 环境变量（GITHUB_REPOSITORY，fork 后零配置）> site.json。
 */
export interface SiteContext {
  owner: string;
  repo: string;
  platform: Platform;
  /** 站点名（Header 徽标文字；空则回退仓库名） */
  name: string;
  /** 主站链接（页脚/tag 跳转等；空则隐藏对应入口） */
  mainSite: string;
  poweredBy: string;
}

// 项目根：Astro dev/build/CI 均以仓库根为工作目录启动（与 lib/archive.ts 同口径）。
// 注意不能用 import.meta.url 推导——rolldown-vite 会把 SSR 模块打进 bundle，
// import.meta.url 指向产物 chunk 而非源码位置，site.json 将定位失败（实测踩坑：
// 构建产物 svp-source 空 owner/repo、首页 h1 空串）。
const ROOT = process.cwd();

function loadSiteJson(): { site?: Partial<SiteContext> } {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8')) as { site?: Partial<SiteContext> };
  } catch {
    return {};
  }
}

let cached: SiteContext | null = null;

export function getSiteContext(): SiteContext {
  if (cached) return cached;
  const cfg = loadSiteJson().site ?? {};

  // CI 注入：github.com/{owner}/{repo}（本地开发走 site.json 预填值）
  let owner = cfg.owner ?? '';
  let repo = cfg.repo ?? '';
  const ghRepo = process.env.GITHUB_REPOSITORY;
  if (ghRepo?.includes('/')) {
    const [o, r] = ghRepo.split('/');
    owner = o || owner;
    repo = r || repo;
  }

  const platform = (SUPPORTED_PLATFORMS as string[]).includes(cfg.platform ?? '')
    ? (cfg.platform as Platform)
    : 'github';

  cached = {
    owner,
    repo,
    platform,
    name: cfg.name ?? '',
    mainSite: cfg.mainSite ?? '',
    poweredBy: cfg.poweredBy ?? 'Sector Vault Project',
  };
  return cached;
}

/** 当前内容仓的平台源码页（「查看源仓库」外链） */
export function sourceRepoUrl(): string {
  const { platform, owner, repo } = getSiteContext();
  return `${PLATFORM_URLS[platform]}/${owner}/${repo}`;
}

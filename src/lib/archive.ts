import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { POSTS_DIR } from '@/config';
import type { SubmissionEntry } from '@/types';
import { getSiteContext } from '@/lib/site';
import { entryFromAttrs, parseReadme } from '@/lib/content';

/**
 * 稿件装载：svp-archive.json（发布管线维护的本地索引）为唯一真源；
 * 缺失/缺条目时扫描 posts/ 目录兜底（slug 即目录名），保证展示层永不因索引滞后而漏稿。
 */

export interface LocalArchive {
  submissions: SubmissionEntry[];
}

export function loadArchive(): SubmissionEntry[] {
  const { owner, repo, platform } = getSiteContext();
  const archivePath = join(process.cwd(), 'svp-archive.json');
  let entries: SubmissionEntry[] = [];
  if (existsSync(archivePath)) {
    try {
      const parsed = JSON.parse(readFileSync(archivePath, 'utf8')) as LocalArchive;
      if (Array.isArray(parsed.submissions)) entries = parsed.submissions;
    } catch {
      /* 损坏的本地索引走目录扫描兜底 */
    }
  }

  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const dir = join(process.cwd(), POSTS_DIR);
  if (existsSync(dir)) {
    for (const slug of readdirSync(dir, { withFileTypes: true })) {
      if (!slug.isDirectory() || bySlug.has(slug.name)) continue;
      // archive 缺条目：目录存在即收录；读 README 属性行回填标题/类型/时间等展示元数据
      // （skeleton 模板仓投稿后本地 svp-archive.json 仍为空，元数据全在 README 头部）
      const readme = readSubmissionReadme(slug.name);
      const attrs = readme ? parseReadme(readme).attrs : {};
      bySlug.set(slug.name, entryFromAttrs(slug.name, attrs, { owner, repo, platform }));
    }
  }

  return [...bySlug.values()].sort(
    (a, b) => Date.parse(b.submittedAt ?? '') - Date.parse(a.submittedAt ?? ''),
  );
}

/** 单篇稿件 README 原文（构建期本地直读；不存在返回 null） */
export function readSubmissionReadme(slug: string): string | null {
  const path = join(process.cwd(), POSTS_DIR, slug, 'README.md');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/** 单篇稿件目录内文件名清单（媒体分流与工程文件下载链接的构建期事实源） */
export function listSubmissionFiles(slug: string): string[] {
  const dir = join(process.cwd(), POSTS_DIR, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name !== 'README.md');
}

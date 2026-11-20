import { POWERED_BY } from '@/config';
import type { SubmissionEntry } from '@/types';

/** 工程文件（来自正文文件列表；* 压缩、** 加密） */
export interface ProjectFile {
  name: string;
  compressed: boolean;
  encrypted: boolean;
}

/** 解析后的内容仓 README 结构 */
export interface ParsedReadme {
  attrs: Record<string, string>;
  body: string;
  files: ProjectFile[];
}

export interface MediaItem {
  name: string;
  kind: 'image' | 'audio' | 'video' | 'other';
  url: string;
}

/**
 * 多值属性解析：YAML 流序列（["a", "b"]）与旧版逗号分隔格式（a, b）兼容。
 * 值首尾空白与空项被去除。（与主站 lib/content 保持同步）
 */
export function parseAttrList(raw: string | undefined): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value).trim()).filter(Boolean);
      }
    } catch {
      /* 非严格 JSON 的 [a, b] 走下方兼容分支 */
    }
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((value) => value.trim().replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);
  }
  return trimmed
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * 解析内容仓 README：
 * 头部固定 *Powered by...*，随后属性行（issue、cover、license 等），
 * 第一个 --- 分隔符后为正文，第二个分隔符后为工程文件列表。
 * （与主站 lib/content 保持同步）
 */
export function parseReadme(raw: string): ParsedReadme {
  const sections = raw.split(/^\s*---\s*$/m);
  const header = sections[0] ?? '';
  // 正文可能包含独立的 --- 行：文件列表取最后一段，中间段重组成正文
  const fileList = sections.length >= 3 ? (sections[sections.length - 1] ?? '') : '';
  const body = sections
    .slice(1, sections.length >= 3 ? -1 : sections.length)
    .join('\n---\n')
    .trim();

  const attrs: Record<string, string> = {};
  for (const line of header.split('\n')) {
    // 兼容旧版管线的 '- key: value' 列表风格属性头
    const trimmed = line.trim().replace(/^- /, '');
    if (!trimmed || trimmed.includes(POWERED_BY)) continue;
    const idx = trimmed.indexOf(':');
    if (idx > 0) {
      attrs[trimmed.slice(0, idx).trim().toLowerCase()] = trimmed.slice(idx + 1).trim();
    }
  }

  const files: ProjectFile[] = [];
  for (const line of fileList.split('\n')) {
    const item = line.trim();
    if (!item.startsWith('- ')) continue;
    const rest = item.slice(2).trim();
    const stars = rest.match(/^\*+/)?.[0].length ?? 0;
    files.push({
      name: rest.slice(stars).trim(),
      compressed: stars === 1,
      encrypted: stars >= 2,
    });
  }

  return { attrs, body, files };
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']);
const AUDIO_EXT = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv']);

/** 文件扩展名 → 媒体类别（详情页工程文件与媒体区的分流依据） */
export function mediaKind(name: string): MediaItem['kind'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'other';
}

/** 构建一篇稿件的完整数据：索引条目 + 本地 README 解析 + 目录内媒体/文件清单 */
export interface SubmissionDoc {
  entry: SubmissionEntry;
  parsed: ParsedReadme;
  /** 目录内全部文件（媒体分流用）；URL 为站点内路径（构建后 posts/ 整目录随产物部署） */
  media: MediaItem[];
  /** 稿件目录内实际存在的文件名（构建期本地扫描） */
  dirFiles: string[];
}

/**
 * README 属性行 → 最小展示条目：索引（svp-archive.json）缺条目时的回填，
 * 构建期目录扫描兜底与运行时 archive 断连降级共用同一份映射。
 * 主场景：skeleton 模板内容仓投稿后本地索引仍为空，展示元数据全在 README 头部。
 */
export function entryFromAttrs(
  slug: string,
  attrs: Record<string, string>,
  source: { owner: string; repo: string; platform: SubmissionEntry['platform'] },
): SubmissionEntry {
  // parseReadme 的属性 key 统一小写（submittedat/publishedat/paramstate），读取须同口径
  const attr = (key: string): string => attrs[key.toLowerCase()] ?? '';
  return {
    slug,
    owner: source.owner,
    repo: source.repo,
    platform: source.platform,
    type: attr('type') === 'article' ? 'article' : 'project',
    title: attr('title') || slug,
    submittedAt: attr('submittedAt') || new Date(0).toISOString(),
    publishedAt: attr('publishedAt') || undefined,
    cover: attr('cover') || undefined,
    paramState: attr('paramState') as SubmissionEntry['paramState'],
    tags: parseAttrList(attr('tags')),
    songs: parseAttrList(attr('songs')),
    engines: parseAttrList(attr('engines')),
    voicebanks: parseAttrList(attr('voicebanks')),
    languages: parseAttrList(attr('languages')),
  };
}

import { LICENSE_FINGERPRINTS, POWERED_BY } from '@/config';

/**
 * 带超时的 fetch：GET 请求到时直接放弃等待并抛错。
 * （构建期用于 SPDX 许可证全文获取；与主站 lib/utils 保持同步）
 */
export async function fetchGetTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method !== 'GET') return fetch(input, init);
  const outer = init?.signal;
  const controller = new AbortController();
  const relay = (): void => controller.abort();
  outer?.addEventListener('abort', relay, { once: true });
  const request = fetch(input, { ...init, signal: controller.signal });
  request.catch(() => {
    /* 超时放弃后底层请求迟到的失败不再上报 */
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('fetch timeout')), 20_000);
  });
  try {
    return (await Promise.race([request, timeout])) as Response;
  } finally {
    clearTimeout(timer);
  }
}

/** 许可证正文归一化（\r\n 归一、行尾去空白、单个末尾换行）——指纹计算与此规则一致 */
export function normalizeLicenseText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return `${lines.join('\n')}\n`;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** LICENSE 文件正文识别为已收录的 SPDX 标识：优先哈希精确匹配，次级比对首行；未识别返回 null */
export async function identifyLicenseText(text: string): Promise<string | null> {
  const normalized = normalizeLicenseText(text);
  const firstLine = (normalized.split('\n').find((line) => line.trim()) ?? '').trim().toLowerCase();
  const hash = await sha256Hex(normalized);
  const byHash = LICENSE_FINGERPRINTS.find((item) => item.sha256 === hash);
  if (byHash) return byHash.id;
  const byLine = LICENSE_FINGERPRINTS.find(
    (item) => item.firstLine.trim().toLowerCase() === firstLine,
  );
  return byLine?.id ?? null;
}

/**
 * SPDX 许可证全文：取不到时回退为 SPDX 标识声明。
 * 文本源为 GitHub licenses API（匿名可用，受速率限制；构建期单仓单次调用）。
 */
export async function spdxLicenseText(license: string): Promise<string> {
  try {
    const response = await fetchGetTimeout(`https://api.github.com/licenses/${license.toLowerCase()}`);
    if (response.ok) {
      const body = ((await response.json()) as { body?: string }).body;
      if (body) return body;
    }
  } catch {
    /* 文本不可用时回退声明式内容 */
  }
  return `${license}\n\nSPDX-License-Identifier: ${license}\n\n*${POWERED_BY}*\n`;
}

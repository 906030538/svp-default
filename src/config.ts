import type { Platform } from './types';
import type { MessageKey } from './i18n';

/** 站点名：site.json 可配置，缺省回退「{owner} 的投稿集合」语义由页面词条处理 */
export const SITE_NAME = 'SVP - Sector Vault Project';

/** 内容仓数据目录：投稿目录为 posts/[slug]（DESIGN.md 内容仓结构） */
export const POSTS_DIR = 'posts';

/** 默认分页条数 */
export const PAGE_SIZE = 10;

/** 支持的 git 平台（用于「查看源仓库」外链） */
export const SUPPORTED_PLATFORMS: Platform[] = ['github', 'gitee', 'atomgit'];

export const PLATFORM_URLS: Record<Platform, string> = {
  github: 'https://github.com',
  gitee: 'https://gitee.com',
  atomgit: 'https://atomgit.com',
};

/** 页脚署名（site.json 的 poweredBy 可覆盖） */
export const POWERED_BY = 'Sector Vault Project';

/** 默认许可证选项（与主站口径一致：CC0、CC4.0 全系） */
export const LICENSE_OPTIONS: { value: string; label: string }[] = [
  { value: 'CC0-1.0', label: 'CC0 1.0' },
  { value: 'CC-BY-4.0', label: 'CC BY 4.0' },
  { value: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0' },
  { value: 'CC-BY-NC-4.0', label: 'CC BY-NC 4.0' },
  { value: 'CC-BY-NC-SA-4.0', label: 'CC BY-NC-SA 4.0' },
  { value: 'CC-BY-ND-4.0', label: 'CC BY-ND 4.0' },
  { value: 'CC-BY-NC-ND-4.0', label: 'CC BY-NC-ND 4.0' },
];

/**
 * 已收录许可证标准正文的指纹：正文归一化（\r\n 归一为 \n、行尾去空白、单个末尾换行）
 * 后取 SHA-256。与主站 config.ts 保持同步（来源：GitHub licenses API 与 CC 官方 legalcode.txt）。
 */
export const LICENSE_FINGERPRINTS: { sha256: string; id: string; firstLine: string }[] = [
  { sha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499', id: 'CC0-1.0', firstLine: 'Creative Commons Legal Code' },
  { sha256: 'f5b745ef98087f531e719ee8ca6a96809444573ecc7173c6fa68eaad39b3cc3f', id: 'CC-BY-4.0', firstLine: 'Attribution 4.0 International' },
  { sha256: '9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94', id: 'CC-BY-4.0', firstLine: 'Attribution 4.0 International' },
  { sha256: '2003829cf643d61b00a76088dd31bb11b8029546f24c56b39fd492adb9281483', id: 'CC-BY-SA-4.0', firstLine: 'Attribution-ShareAlike 4.0 International' },
  { sha256: '23ee78c8bae49cf08ea2f0c84945c66b987ebe4520881fb51b3dad4fb43d07c2', id: 'CC-BY-SA-4.0', firstLine: 'Attribution-ShareAlike 4.0 International' },
  { sha256: '3711f963c05d0be80d53e5923308a6dee31b203da23435c9cfb7c7b6e4dd5e19', id: 'CC-BY-NC-4.0', firstLine: 'Attribution-NonCommercial 4.0 International' },
  { sha256: '1349a4b6148492b44f629e64eed676612e234fe9a839e4f3b277c1482c8849f1', id: 'CC-BY-NC-SA-4.0', firstLine: 'Attribution-NonCommercial-ShareAlike 4.0 International' },
  { sha256: '00b6b2ffad0a8a99a0497b6474d16296adb91a9d9d83dd745d3148176aa16b7e', id: 'CC-BY-ND-4.0', firstLine: 'Attribution-NoDerivatives 4.0 International' },
  { sha256: 'f7f28b8c7a1af76b9874ca6d040e8b1eb6768fd1043106c9d315090ea96754e7', id: 'CC-BY-NC-ND-4.0', firstLine: 'Attribution-NonCommercial-NoDerivatives 4.0 International' },
];

/** SPDX 标识 → SPDX 官方描述页（许可证卡外链） */
export function licenseLinks(license: string): { textUrl: string; deedUrl: string } | null {
  const map: Record<string, string> = {
    'CC0-1.0': 'CC0-1.0',
    'CC-BY-4.0': 'CC-BY-4.0',
    'CC-BY-SA-4.0': 'CC-BY-SA-4.0',
    'CC-BY-NC-4.0': 'CC-BY-NC-4.0',
    'CC-BY-NC-SA-4.0': 'CC-BY-NC-SA-4.0',
    'CC-BY-ND-4.0': 'CC-BY-ND-4.0',
    'CC-BY-NC-ND-4.0': 'CC-BY-NC-ND-4.0',
  };
  const id = map[license];
  if (!id) return null;
  return {
    textUrl: `https://creativecommons.org/legalcode/${id.toLowerCase()}`,
    deedUrl: `https://creativecommons.org/licenses/${id
      .replace(/^CC-/, '')
      .toLowerCase()}/4.0/deed.zh-hans`,
  };
}

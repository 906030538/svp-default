/**
 * 站点 base 路径工具：GitHub Pages 等子路径部署时（如 /SectorVaultProject/），
 * 站内链接生成与路由解析都必须感知前缀。BASE_URL 由 Astro 按 base 配置注入。
 *
 * 相对 base（ASTRO_BASE='./'，便携构建）：站内路径按页面深度解析（嵌套页需
 * ../ 回退）；页面导航链接补 index.html——file:// 协议不做目录→index.html
 * 映射，双击打开 dist/index.html 也能完整导航。部署构建（绝对 base）行为
 * 与历版完全一致。
 */

export const BASE: string = import.meta.env.BASE_URL ?? '/';

/** 相对 base 模式（便携构建）。vite 会把 './' 规范化为 '/./'，两种形态都认 */
export const RELATIVE_BASE: boolean =
  BASE === '.' || BASE.startsWith('./') || BASE.startsWith('/./');

/** 按页面深度生成相对前缀（depth = 站点根到当前页的目录层数） */
function depthPrefix(depth: number): string {
  return '../'.repeat(Math.max(0, depth)) || './';
}

/** 站内资产/媒体路径加 base 前缀（输入以 / 开头；不补 index.html） */
export function withBase(path: string, depth = 0): string {
  if (RELATIVE_BASE) return `${depthPrefix(depth)}${path.replace(/^\//, '')}`;
  if (!BASE || BASE === '/') return path;
  return `${BASE.replace(/\/$/, '')}${path}`;
}

/**
 * 站内页面导航链接：相对 base 下补 /index.html（file:// 目录链接不映射
 * index.html，浏览器会落到目录列表）；部署模式与 withBase 等价（服务器
 * 自动做目录映射）。
 */
export function pageUrl(path: string, depth = 0): string {
  if (RELATIVE_BASE) {
    const rel = path.replace(/^\/|\/+$/g, '');
    return `${depthPrefix(depth)}${rel ? `${rel}/` : ''}index.html`;
  }
  return withBase(path);
}

/** 从 pathname 中剥离 base 前缀（供路由解析） */
export function stripBase(pathname: string): string {
  if (!BASE || BASE === '/') return pathname;
  const prefix = BASE.replace(/\/$/, '');
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
}

/**
 * 客户端：本页资产前缀（媒体等文件路径）。便携构建由 BaseLayout 按页烧入
 * <html data-asset-prefix>；部署模式不烧该属性，回退构建期 BASE（与
 * withBase 同口径）。共享 chunk 无法在构建期感知所在页深度，故从 DOM 读。
 */
export function assetBase(path: string): string {
  const prefix = document.documentElement.dataset.assetPrefix;
  if (prefix === undefined) return withBase(path);
  return `${prefix}${path.replace(/^\//, '')}`;
}

/** 客户端：本页导航链接（含 index.html 补全规则，同 pageUrl） */
export function pageBase(path: string): string {
  const prefix = document.documentElement.dataset.assetPrefix;
  if (prefix === undefined) return withBase(path);
  const rel = path.replace(/^\/|\/+$/g, '');
  return `${prefix}${rel ? `${rel}/` : ''}index.html`;
}

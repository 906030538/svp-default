import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Markdown 渲染：marked → DOMPurify 净化 → HTML 字符串（构建期 SSG 与
 * 浏览器实时渲染共用）。净化配置与主站运行时管线同口径：默认严格配置，
 * 仅放开链接/图片协议的 http(s) 与 data:image。
 * DOMPurify 需要真实 window：浏览器直接用全局实例；node 侧经 jsdom 注入
 * （动态 import + import.meta.env.SSR 守卫，jsdom 不进客户端包）。
 */

marked.setOptions({ gfm: true, breaks: false });

type Purifier = { sanitize: (dirty: string) => string };

/** 环境判定：vite 将 import.meta.env.SSR 静态替换（客户端 false / SSR true）；裸 node（自检脚本）无 env，视为服务端 */
function isServerEnv(): boolean {
  try {
    return import.meta.env.SSR !== false;
  } catch {
    return true;
  }
}

let purifier: Purifier | null = null;

async function getPurifier(): Promise<Purifier> {
  if (purifier) return purifier;
  if (!isServerEnv() && typeof window !== 'undefined') {
    purifier = DOMPurify as unknown as Purifier;
  } else {
    // 裸说明符经变量 + @vite-ignore：打包器不为浏览器产物收集 jsdom
    // （本分支客户端永不到达）；裸 node（scripts/verify-build.mjs、astro build SSR）
    // 运行时原生解析 node_modules。
    const specifier = 'jsdom';
    const { JSDOM } = (await import(/* @vite-ignore */ specifier)) as typeof import('jsdom');
    purifier = DOMPurify(new JSDOM('').window) as unknown as Purifier;
  }
  return purifier;
}

export async function renderMarkdown(md: string): Promise<string> {
  const dirty = marked.parse(md, { async: false });
  return (await getPurifier()).sanitize(dirty);
}

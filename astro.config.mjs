import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// site/base 经环境变量注入（CI 自动适配 <owner>.github.io/<repo> 子路径部署）。
// 本地开发不设置即可（base=/）。自定义域名见 docs/PERSONAL-SITE.md。
// 便携构建（ASTRO_BASE='./'）：禁用 modulePreload——其 polyfill 含 import.meta
// 与硬编码 / 前缀，classic script 化后不可用；esbuild 会静态内联动态 import。
const portable = process.env.ASTRO_BASE?.startsWith('.');
export default defineConfig({
  site: process.env.ASTRO_SITE,
  base: process.env.ASTRO_BASE || '/',
  vite: {
    plugins: [tailwindcss()],
    build: { modulePreload: portable ? false : undefined },
  },
});

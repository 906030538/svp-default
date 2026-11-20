#!/usr/bin/env node
/**
 * 便携构建：产物可直接双击 dist/index.html 打开（file:// 协议），也可整目录
 * 拷贝/压缩包分享。部署构建（npm run build / CI）不受影响。
 *
 * 两件事挡住 file://，逐一处理：
 * 1. 相对路径：ASTRO_BASE='./' 构建，站内链接/媒体按页面深度解析
 *    （src/lib/base.ts + BaseLayout 烧入 data-asset-prefix）。
 * 2. 模块脚本：file:// 页面禁止外链 type="module"（CORS），把全站入口
 *    合并为一个 classic script（esbuild IIFE，动态 import 静态内联），
 *    各页以 <script defer src> 外链共享一份——classic 外链不受限。
 *
 * 用法：npm run build:portable
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// ── 1. 相对 base 构建 ─────────────────────────────────────────────
console.log('[1/3] astro build (relative base)');
const env = { ...process.env, ASTRO_BASE: './' };
delete env.ASTRO_SITE; // 便携产物不指向部署域
const astroBin = join(ROOT, 'node_modules', '.bin', 'astro');
const built = spawnSync(astroBin, ['build'], { stdio: 'inherit', env, cwd: ROOT });
if (built.status !== 0) {
  console.error('astro build failed');
  process.exit(built.status ?? 1);
}

// ── 2. 收集页面模块入口，合并为一个 classic bundle ────────────────
console.log('[2/3] bundle module scripts into one classic script');

// 媒体与工程文件随产物部署（CI 部署构建的「Copy posts assets」步骤在本地
// 构建不执行；便携产物必须自带，否则 file:// 打开无图无音频）
const postsDir = join(ROOT, 'posts');
try {
  await cp(postsDir, join(DIST, 'posts'), { recursive: true });
  console.log('posts/ assets copied');
} catch {
  console.log('posts/ not found — skip asset copy');
}

const htmlPaths = await (async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full)));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
})(DIST);

const moduleRe = /<script\s+type="module"\s+src="([^"]+)"[^>]*><\/script>/g;
const entries = new Set(); // 文档出现顺序（Set 去重）
const perPage = [];
for (const htmlPath of htmlPaths) {
  const html = await readFile(htmlPath, 'utf8');
  const srcs = [...html.matchAll(moduleRe)].map((m) => m[1]);
  perPage.push({ htmlPath, srcs });
  for (const src of srcs) {
    const abs = src.startsWith('/') ? join(DIST, src) : resolve(dirname(htmlPath), src);
    entries.add(abs);
  }
}
if (entries.size === 0) {
  console.log('no module scripts found — nothing to do');
  process.exit(0);
}

const entryFile = join(tmpdir(), `svp-portable-entry-${Date.now()}.mjs`);
// esbuild 不解析 file:// URL 说明符；绝对 fs 路径按路径解析
await writeFile(
  entryFile,
  [...entries].map((p) => `import ${JSON.stringify(p)};`).join('\n') + '\n',
);
const result = await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  write: false,
  outdir: 'out', // write:false 时仅用于命名 outputFiles
  legalComments: 'none',
  define: {
    // 与 vite 客户端注入同口径：SSR=false 走浏览器分支（jsdom 分支不可达），
    // BASE_URL='./'（本次构建即相对 base）
    'import.meta.env.SSR': 'false',
    'import.meta.env.BASE_URL': '"./"',
  },
  // rolldown 常量传播会把 markdown.ts 的变量说明符动态 import 固化为
  // import("jsdom") 字面量——external 阻止其进包（浏览器分支不可达，
  // classic script 里保留的 import() 表达式合法且永不执行）
  external: ['jsdom'],
  alias: { '@': join(ROOT, 'src') },
  logLevel: 'warning',
});
let bundleJs = result.outputFiles[0].text;
await rm(entryFile, { force: true });

// 降级 vite 动态 import 预加载包装：__vitePreload(factory, deps([n..])) 的
// deps 项指向原始 chunk 文件（已内联进本 bundle 且文件已删除），且 helper
// 依赖 import.meta.url（IIFE 下为空对象）——删掉 deps 参数，factory 直接
// 执行。仅此形态（factory 尾括号 + 数字数组实参）出现于 preload 包装，
// 业务代码无此模式。
const before = bundleJs.length;
bundleJs = bundleJs.replace(
  /\)\s*,\s*\w+\(\[\d+(?:,\d+)*\]\)\s*\)/g,
  '))',
);
if (before === bundleJs.length) {
  console.warn('warn: no __vitePreload deps pattern found — dynamic imports may fail');
}

const appDir = join(DIST, '_astro');
await mkdir(appDir, { recursive: true });
const appPath = join(appDir, 'app.js');
await writeFile(appPath, bundleJs);

// ── 3. 改写页面：module 标签 → 单个共享 classic 外链（defer 保 DOM 就绪）──
console.log('[3/3] rewrite pages');
for (const { htmlPath, srcs } of perPage) {
  if (srcs.length === 0) continue;
  let html = await readFile(htmlPath, 'utf8');
  const appRel = relative(dirname(htmlPath), appPath).split(sep).join('/');
  const tag = `<script defer src="${appRel.startsWith('.') ? appRel : `./${appRel}`}"></script>`;
  let first = true;
  html = html.replace(moduleRe, () => (first-- ? tag : ''));
  // 已内联资源的预取提示一并移除
  html = html.replace(/<link\s+rel="modulepreload"[^>]*>\s*/g, '');
  // Astro 资产 URL（css/favicon/logo）以 vite 规范化的 /./ 前缀输出且不随页深
  // 相对化——file:// 下解析到盘符根。按本页目录深度重写为真实相对路径。
  // ?url 导入的资产（favicon/logo）则是 /_astro/ 绝对形态，同样处理。
  const depth = relative(DIST, dirname(htmlPath)).split(sep).filter(Boolean).length;
  const assetPrefix = '../'.repeat(depth) || './';
  html = html.replace(/(\s(?:href|src)=")\/\.\//g, `$1${assetPrefix}`);
  html = html.replace(/(\s(?:href|src)=")\/(_astro\/)/g, `$1${assetPrefix}$2`);
  // Astro 对无 import 的小脚本输出内联 module（如首页 tab 切换）。inline module
  // 本体在 file:// 下可执行，但为跨浏览器一致性与稳妥性统一降为 classic
  // （位置在 body 尾、DOM 已就绪，执行时序等价）
  html = html.replace(/<script\s+type="module">/g, '<script>');
  await writeFile(htmlPath, html);
}

// 清理被内联的原始 chunk（含动态 import 目标，均已成 app.js 的一部分；
// 保留 _astro 下的 css/图标等非 JS 资源）
for (const file of await readdir(appDir)) {
  if (file.endsWith('.js') && file !== 'app.js') await rm(join(appDir, file), { force: true });
}

const bundleSize = (bundleJs.length / 1024).toFixed(0);
console.log(`portable build ready: dist/ (${htmlPaths.length} pages, app.js ${bundleSize} KB)`);
console.log('open dist/index.html directly (file://), or zip the dist/ folder to share.');

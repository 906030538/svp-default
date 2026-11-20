import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E2E mock 站点构建器（开发工具，不进产物）：
 * 复制 dist/ → dist-mock/，并在每个 HTML 的 <head> 注入 fetch 补丁——
 * 把内容仓远端请求（raw.githubusercontent / api.github.com）替换为受控 mock 数据，
 * 用于在「未重新部署」前提下验证列表合并 / hash 实时视图 / 详情热替换 / 移除提示。
 *
 * 用法：npm run build && node scripts/e2e/build-mock-site.mjs && node scripts/e2e/serve.mjs
 * 场景断言口径见 docs/PERSONAL-SITE.md「E2E」一节。
 */

const ROOT = new URL('../..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'dist-mock');

// ---------- mock 数据 ----------

const archive = JSON.parse(readFileSync(join(ROOT, 'svp-archive.json'), 'utf8'));

const readme999999 = `*Powered by Sector Vault Project*
issue: E2EMOCK
title: E2E 新增稿件（未部署）
type: project
submittedAt: 2026-11-05T00:00:00.000Z
publishedAt: 2026-11-05T00:00:00.000Z
paramState: with-params
engines: [Synthesizer V]
voicebanks: [POPY]
languages: [zh]
tags: [E2E, 测试]

---

# E2E 新增稿件正文

这段内容来自远端（mock）——真实场景中它是 push 之后、重新部署之前的仓库最新 README。

<xss-probe-script>alert('xss-script')</xss-probe-script>

<img src=x onerror="alert('xss-img')">

**加粗**、[外链](https://example.com/e2e) 与 \`code\`。
`.replace('<xss-probe-script>', '<' + 'script>').replace('</xss-probe-script>', '</' + 'script>');

const readme240117Base = readFileSync(join(ROOT, 'posts/240117-向着无尽的灰/README.md'), 'utf8');
// 改稿注入位置必须在正文段内（第一个 --- 与第二个 --- 之间）：
// parseReadme 是三段式语义（属性 / 正文 / 工程文件列表），追加到文件末尾
// 会落进文件列表段被忽略（实测踩坑：热替换渲染了但正文无标记）。
const readme240117Marker = '\n\n## E2E 改稿标记（mock 注入）\n\n这段文字模拟 push 后未重新部署的正文修改——详情页应热替换并出现「已更新」徽标。\n';
const sepPositions = [];
{
  const re = /^---\s*$/gm;
  let m;
  while ((m = re.exec(readme240117Base)) !== null) sepPositions.push(m.index);
}
let readme240117;
if (sepPositions.length >= 2) {
  // 在第二个分隔符（正文段边界）前插入标记段
  const cut = sepPositions[1];
  readme240117 = readme240117Base.slice(0, cut) + readme240117Marker + '\n' + readme240117Base.slice(cut);
} else if (sepPositions.length === 1) {
  readme240117 = readme240117Base + readme240117Marker;
} else {
  readme240117 = readme240117Base + '\n---' + readme240117Marker;
}

const readme260913 = readFileSync(join(ROOT, 'posts/260913-SV导出音频声道注意事项/README.md'), 'utf8');
const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8');

// 索引：+1 新稿（列表合并 → hash 链接）；260913 标题修订（展示字段签名变化 → 热替换）
archive.submissions.unshift({
  slug: '999999-E2E新增稿件',
  owner: 'CLCNTanya',
  repo: 'svp-default',
  platform: 'github',
  type: 'project',
  title: 'E2E 新增稿件（未部署）',
  submittedAt: '2026-11-05T00:00:00.000Z',
  publishedAt: '2026-11-05T00:00:00.000Z',
  paramState: 'with-params',
  engines: ['Synthesizer V'],
  voicebanks: ['POPY'],
  languages: ['zh'],
  tags: ['E2E', '测试'],
});
const revised = archive.submissions.find((e) => e.slug === '260913-SV导出音频声道注意事项');
if (revised) revised.title = 'SV导出音频声道注意事项（修订版）';

const dirEntry = (name) => ({ name, type: 'file', path: `posts/x/${name}`, sha: 'e2e', size: 1 });
const dirlist999999 = [dirEntry('README.md'), dirEntry('e2e-cover.jpg'), dirEntry('e2e-demo.mp3')];
const dirlist240117 = ['656999453f2f3d0e41f8dca4fba0390a6155265a.jpg', 'MV_size.sesx', '限りなく灰色へ_short.svp'].map(dirEntry);
const dirlist260913 = [];

const mock = { archive, readme999999, readme240117, readme260913, dirlist999999, dirlist240117, dirlist260913, license };

// ---------- fetch 补丁（经典脚本，先于模块脚本执行） ----------
// 注意：mock 数据内联进 <script> 前必须把 < 转义为 \u003c——
// XSS 探针里的字面 </script> 会提前终结外层 script 标签（实测踩坑）。

const mockJson = JSON.stringify(mock).replace(/</g, '\\u003c');
const harness = `<script>
(function () {
  var M = ${mockJson};
  function J(o) { return new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } }); }
  function T(s) { return new Response(s, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
  function NF() { return new Response('Not Found', { status: 404 }); }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || '');
    if (url.indexOf('/svp-archive.json') >= 0) return Promise.resolve(J(M.archive));
    if (url.indexOf('/posts/999999-E2E') >= 0 && url.indexOf('README.md') >= 0) return Promise.resolve(T(M.readme999999));
    if (url.indexOf('/contents/posts/999999-E2E') >= 0) return Promise.resolve(J(M.dirlist999999));
    if (url.indexOf('/posts/240117-') >= 0 && url.indexOf('README.md') >= 0) return Promise.resolve(T(M.readme240117));
    if (url.indexOf('/contents/posts/240117-') >= 0) return Promise.resolve(J(M.dirlist240117));
    if (url.indexOf('/posts/240502-') >= 0 && url.indexOf('README.md') >= 0) return Promise.resolve(NF());
    if (url.indexOf('/posts/260913-') >= 0 && url.indexOf('README.md') >= 0) return Promise.resolve(T(M.readme260913));
    if (url.indexOf('/contents/posts/260913-') >= 0) return Promise.resolve(J(M.dirlist260913));
    if (url.indexOf('/LICENSE') >= 0) return Promise.resolve(T(M.license));
    return realFetch(input, init);
  };
  window.__E2E_MOCK_ACTIVE = true;
})();
</script>`;

// ---------- 生成 dist-mock ----------

rmSync(OUT, { recursive: true, force: true });
cpSync(DIST, OUT, { recursive: true });

let count = 0;
function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p);
    else if (name.name.endsWith('.html')) {
      const html = readFileSync(p, 'utf8');
      writeFileSync(p, html.replace('<head>', '<head>\n' + harness));
      count++;
    }
  }
}
mkdirSync(OUT, { recursive: true });
walk(OUT);
console.log(`dist-mock ready: ${count} html files patched, ${archive.submissions.length} archive entries`);

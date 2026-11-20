# 个人展示站（Personal Site）

内容仓自含的静态展示站：把当前仓库的稿件（`posts/`）渲染成
「集合页 + 稿件详情页」，构建期 SSG 全静态输出，无运行时依赖。

与 SVP 主站的区别：主站是聚合站（读索引仓 + 三平台 API 动态渲染，
SPA 回退）；本站只读**本仓**数据（`svp-archive.json` + `posts/` 目录），
媒体与工程文件随产物一起部署，fork 后开 GitHub Pages 即用。

## 快速开始（GitHub Pages）

1. fork / 使用本模板建仓（或直接在本仓操作）
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**
3. push 到 main，`Deploy site` workflow 自动构建发布
4. 访问 `https://<owner>.github.io/<repo>`

workflow 会自动注入 `GITHUB_REPOSITORY`（站点头部坐标）与
`ASTRO_SITE` / `ASTRO_BASE`（子路径部署），无需手改配置。

## 配置（site.json）

| 字段 | 说明 | 缺省 |
|---|---|---|
| `site.name` | 站点名（Header 徽标文字） | 仓库名 |
| `site.owner` / `site.repo` / `site.platform` | 内容仓坐标（本地开发用；CI 里被 GITHUB_REPOSITORY 覆盖 owner/repo） | — |
| `site.mainSite` | 页脚「Powered by」链接（主站地址） | 空则纯文字 |
| `site.poweredBy` | 页脚署名文字 | Sector Vault Project |

## 自定义域名

1. workflow 里把 `ASTRO_SITE` 改为你的域名（如 `https://svp.example.com`），`ASTRO_BASE` 置空
2. 仓库 Settings → Pages → Custom domain 填入域名
3. DNS 加 CNAME 记录指向 `<owner>.github.io`

## 数据来源与兜底

- **主源**：`svp-archive.json`（发布管线维护的本地索引，title/type/tags 等元数据）
- **兜底**：`posts/` 目录扫描（archive 缺条目时按目录名收录，title 回退 slug）

即：只要稿件目录存在，站点就不会漏稿。

## 稿件元数据

`posts/<slug>/README.md` 头部属性行（与 SVP 主站内容仓口径一致）：
`issue` / `type` / `title` / `submittedAt` / `publishedAt` / `cover` /
`songs` / `engines` / `voicebanks` / `languages` / `videos` / `tags` /
`paramState`，多值用 YAML 流序列 `["a", "b"]`（旧版逗号分隔兼容）。

正文 Markdown 渲染管线与主站同口径（marked → DOMPurify 净化），
构建期完成；运行时热替换共用同一管线（浏览器端 DOMPurify，与主站实时视图同口径）。

## 运行时新鲜度（hash 路由 + 未部署读最新）

SSG 产物是基线，客户端启动后自动从内容仓匿名拉取最新数据增强：

| 场景 | 行为 |
|---|---|
| 列表页 | 远端 `svp-archive.json` 与构建期快照**并集合并**（远端字段优先；构建期已知 slug 永不丢失），新稿件卡片出现并链接到 `#/post/{slug}` 实时视图 |
| `#/post/{slug}`（hash 实时视图） | 按需动态加载模块，从内容仓拉 README + 目录清单 + LICENSE 渲染完整详情；slug 白名单与索引仓 submission.schema 同口径 |
| 已部署详情页 | 新鲜度检查：README 404 → 顶部「已从仓库移除」提示（保留构建期内容）；README 哈希或索引展示字段签名变化 → 热替换为最新内容 + 「已更新」徽标，媒体切换为平台 raw 直链 |
| 索引（archive）拉取失败 | 不阻断：hash 视图从 README 属性行回填最小条目继续渲染（实测 raw 断连窗口内的降级路径） |

**端点选型**（三平台真实仓库带 Origin 实测，2026-11）：

| 平台 | 文本（README/archive/LICENSE） | 目录列举 | 媒体/工程文件 |
|---|---|---|---|
| GitHub | raw.githubusercontent（ACAO:*，无 API 限额） | api.github.com contents | raw 直链 |
| Gitee | api/v5 contents（ACAO:*；raw 端点为 302 签名链无 CORS） | api/v5 contents | raw 直链 |
| AtomGit | api/v5 contents（ACAO 回显；raw 端点为反爬壳） | api/v5 contents | raw 直链 |

**已知边界**：

- 仅支持**公开仓库**匿名访问；私有仓需自行部署带鉴权取数层（不在模板范围）
- Gitee/AtomGit 走 contents API 受匿名限额约束（按 IP）；GitHub raw 无限额但个别网络环境下存在随机断连（有降级路径兜底）
- 详情热替换的触发信号 = README SHA-256 + 索引展示字段签名；**目录内媒体文件增删**（不改 README/索引）不触发已部署页面的刷新（hash 实时视图总是最新）
- hash 子路由无独立预渲染 HTML、不被搜索引擎索引（与主站 SPA 回退同边界）；已部署的 path 页面 SEO 不受影响
- 跨域媒体走平台 raw 直链：`<img>/<audio>/<video>` 与下载跳转无 CORS 要求，速度取决于平台线路

## 本地开发

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # 产物 dist/（需再 cp -r posts dist/posts 供媒体访问）
npm run check    # astro check 类型检查
node --import ./scripts/alias.mjs scripts/verify-build.mjs   # 净化管线 + 生成器转义 + LICENSE 识别自检
```

## 便携构建（本地双击打开 / 压缩包分享）

```sh
npm run build:portable    # 产物 dist/，双击 dist/index.html 即可浏览
```

便携产物与部署产物同源同功能（列表 / 详情 / 媒体 / 主题 / 四语言 / hash 实时视图 /
详情热替换），可整目录压缩分享，接收方解压双击即看，无需任何服务器。

**原理**（`scripts/build-portable.mjs`，处理 file:// 协议的两个限制）：

1. **相对路径**：`file://` 没有站点根，绝对路径会解析到盘符根。便携构建以相对
   base（`ASTRO_BASE='./'`）构建，站内链接 / 媒体按页面目录深度生成（嵌套页
   `../` 回退），页面导航链接补全 `index.html`（`file://` 不做目录→首页映射），
   `BaseLayout` 按页烧入 `data-asset-prefix` 供共享脚本解析深度。
2. **模块脚本**：`file://` 页面禁止外链 `type="module"`（CORS 限制）。构建后把
   全站脚本入口合并为单个 classic script（`_astro/app.js`，esbuild IIFE，动态
   import 静态内联），各页以 `<script defer src>` 外链共享一份。

**边界**：

- 部署模式（`npm run build` / CI）产物完全不受影响——URL 形态、module script
  均与历版一致（`data-asset-prefix` 不输出、相对分支不激活）。
- 站外功能照常依赖网络：hash 实时视图与热替换仍从 GitHub/Gitee 拉取（离线时
  静默降级为构建期内容）；B 站等外链视频同理。
- 语法层兼容 es2020（Chrome 80+ / Firefox 78+ / Safari 14+）；classic 外链
  script 在 `file://` 下属各浏览器长期行为，无额外要求。

## E2E 回归（开发工具）

```sh
npm run build && cp -r posts dist/posts
node scripts/e2e/build-mock-site.mjs   # dist → dist-mock，注入 fetch 补丁模拟远端四种状态
node scripts/e2e/serve.mjs             # http://localhost:4323（正确 MIME）
```

mock 场景：新增稿件（列表合并 + hash 链接）/ 改稿（热替换 + 已更新徽标 + XSS 探针净化）/
索引签名变化（标题修订热替换）/ 稿件移除（404 → 移除提示）。
真实网络无变化场景直接 `node scripts/e2e/serve.mjs 4326 dist` 后浏览器访问。

## 与主站功能差异（裁剪面）

- 无登录 / 写操作（评论、编辑、删除、镜像管理）——去主站控制台操作
- 无敏感词 gate——内容责任在仓库属主（自部署实例条款由部署者制定）
- 无 discussions / 用户主页 / 多线路切换
- 灯箱、zip 在线解压为二期候选，当前媒体直链打开

## LICENSE

仓库根 `LICENSE` 构建期自动识别（SHA-256 指纹，支持 CC0 / CC 4.0 全系），
展示在首页与详情页作者卡；识别不出则隐藏。

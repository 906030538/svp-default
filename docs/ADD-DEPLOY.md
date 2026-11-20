# 给已投稿的内容仓添加独立部署

适用：用 **svp-skeleton** 模板建仓、已经在 `posts/` 里投稿的仓库。
效果：仓库变成一个可独立访问的个人展示站（只展示本仓稿件），**不影响继续投稿**。

全程约 5 分钟 + 一次 push。

---

## 第 1 步：把站点文件复制进仓库

站点代码来自 [svp-default](https://github.com/906030538/svp-default)（个人展示站模板）。

### 方式 A：命令行（推荐）

在你的内容仓根目录执行：

```bash
git remote add site-template https://github.com/906030538/svp-default.git
git fetch site-template main --depth 1

git checkout site-template/main -- \
  src scripts \
  astro.config.mjs package.json package-lock.json tsconfig.json site.json \
  favicon.svg logo-small.svg \
  .github/workflows/deploy-site.yml

rm scripts/sync-mirrors.mjs   # 主站模板专有，个人站用不到
git remote remove site-template
```

需要在线编辑器再加一句：`git checkout site-template/main -- public/admin docs/PERSONAL-SITE.md`

### 方式 B：不用命令行

到 svp-default 仓库页 → **Code → Download ZIP** → 解压后，把下面清单里的文件/目录拷进自己的仓库（网页上传即可）。

### 复制清单

| 复制 | 说明 |
|---|---|
| `src/`、`scripts/` | 站点源码与自检脚本 |
| `astro.config.mjs`、`package.json`、`package-lock.json`、`tsconfig.json` | 构建配置（四个都要，`npm ci` 依赖 lock 文件） |
| `site.json` | 站点坐标（下一步要改） |
| `favicon.svg`、`logo-small.svg` | 站点图标 |
| `.github/workflows/deploy-site.yml` | 自动部署 |
| `public/admin/`（可选） | Decap CMS 在线编辑器，不需要可跳过 |
| `docs/PERSONAL-SITE.md`（可选） | 完整参考文档 |

**保留自己的，不要覆盖**：

- `posts/` —— 你的稿件
- `svp-archive.json` —— 即使是空的 `{"submissions": []}` 也**不用维护**：构建时自动扫描 `posts/` 并读取每篇 README 头部的 title / type / submittedAt 等属性行
- `README.md`、`LICENSE`

**不要复制**（svp-default 专有）：

- `posts/` 里的示例稿件
- `.github/workflows/sync-mirrors.yml`、`.workflow/`、`scripts/sync-mirrors.mjs`（三平台镜像同步，主站模板专用；方式 A 已在命令里剔除）

最后新建 `.gitignore`（skeleton 没有这个文件）：

```
node_modules/
dist/
.astro/
```

## 第 2 步：改 site.json

```json
{
  "site": {
    "name": "",
    "owner": "你的用户名",
    "repo": "你的仓库名",
    "platform": "github",
    "mainSite": "https://svp.lyoko.cn",
    "poweredBy": "Sector Vault Project"
  }
}
```

- `name`：站名，留空 = 显示仓库名
- `owner` / `repo`：你的仓库坐标（GitHub Actions 部署时会自动覆盖，改了主要是本地预览正确）
- `platform`：仓库**实际所在平台**（`github` / `gitee` / `atomgit`）——决定「查看源仓库」外链指向哪

## 第 3 步：开启 GitHub Pages

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
2. push 到 `main`，Actions 自动构建部署
3. 等一两分钟，访问 `https://<用户名>.github.io/<仓库名>/`

完成。

---

## 常见问题

**本地预览**：Node 20+，`npm install && npm run dev` → http://localhost:4321

**自定义域名**：见 [PERSONAL-SITE.md](PERSONAL-SITE.md)（`ASTRO_SITE` + CNAME）。

**仓库不在 GitHub 上？** 站点产物是纯静态 `dist/`，任何静态托管（Cloudflare Pages、EdgeOne Pages 等）都能部署；Gitee / AtomGit 的仓库也可以把文件推一份到 GitHub 镜像来用 Pages，`site.json` 的 `platform` 照实填即可。

**部署后又投了新稿？** 两层保障：push 稿件后 Actions 自动重建；**即使没重新部署**，站点也会在访问时自动从仓库拉最新内容（列表自动出现新稿件，点进去是实时视图）。

**会影响投稿吗？** 不会。主站收录只读 `posts/` 与 `svp-archive.json`，站点文件互不干扰；反过来站点也不改变任何投稿流程。

**想隐藏部分稿件？** 当前口径是「目录存在即展示」。把不想展示的稿件目录移出 `posts/`（主站投稿同样以 `posts/` 为准，移动前请确认主站索引状态）。

**想给朋友看但不想部署？** `npm run build:portable` 生成「便携产物」——直接双击 `dist/index.html` 就能浏览（本地 file:// 打开），把整个 `dist/` 目录压缩发给别人也行，对方解压双击即看。原理与边界见 [PERSONAL-SITE.md](PERSONAL-SITE.md)「便携构建」一节。

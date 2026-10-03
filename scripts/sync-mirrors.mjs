#!/usr/bin/env node
/**
 * 镜像同步脚本：把主仓库的 Issue / Release（含附件）同步到镜像仓库。
 *
 * 同步规则：
 *   1. 读取 svp-archive.json 的 mirrors 字段，第一位为主仓库；
 *   2. 当前仓库（由环境变量或 git remote 自动识别）若是镜像仓库，从主仓库同步自身；
 *   3. 无 CI 平台（atomgit.com）的镜像无法自己触发流水线，由主仓库的流水线
 *      通过 API 代为创建（若主仓库也无 CI，则由各镜像流水线代管）；
 *   4. issue 按同名（标题精确匹配）补建，并对齐开启/关闭状态；
 *   5. release 按同 TAG 补建，复制真实上传的附件；平台自动生成的源码包会被忽略。
 *
 * 支持 gitee.com、github.com、atomgit.com（atomgit 仅作为镜像目标，其平台无流水线）。
 *
 * 用法（Node.js >= 18，无第三方依赖）：
 *   node scripts/sync-mirrors.mjs
 *
 * 环境变量：
 *   MIRROR_SYNC_CURRENT_REPO  当前仓库标识 host/owner/repo（缺省时自动识别：
 *                             GitHub Actions 环境变量 → git remote origin）
 *   GITHUB_TOKEN              github.com 令牌（当前仓库/代管目标在 GitHub 时必须提供，
 *                             需要 issues 与 contents 写权限）
 *   GITEE_TOKEN               gitee.com 私人令牌（当前仓库/代管目标在 Gitee 时必须提供，
 *                             需要 projects 权限；主仓库在 Gitee 且私有/限流时建议提供。
 *                             别名 GITEE_ACCESS_TOKEN 亦可）
 *   ATOMGIT_TOKEN             atomgit.com 访问令牌（代管同步 AtomGit 镜像时必须提供）
 *   MIRROR_SYNC_DRY_RUN       设为 true 时只打印同步计划，不执行任何写操作
 *   MIRROR_SYNC_ARCHIVE       归档文件路径，默认 svp-archive.json
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';

const DRY_RUN = /^(1|true|yes)$/i.test(process.env.MIRROR_SYNC_DRY_RUN || '');
const ARCHIVE_PATH = process.env.MIRROR_SYNC_ARCHIVE || 'svp-archive.json';
// 平台为 tag 自动生成的源码包（zip / tar.gz 等），不是用户上传的附件，同步时忽略：
// gitee / github 为 /archive/refs/tags/，atomgit 为 /-/archive/
const AUTO_ARCHIVE_MARKERS = ['/archive/refs/tags/', '/-/archive/'];
const isAutoArchive = (url) => AUTO_ARCHIVE_MARKERS.some((marker) => url.includes(marker));
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

const MIME_TYPES = {
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

const log = (msg) => console.log(msg);
const warn = (msg) => console.warn(`[警告] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- 仓库标识 ---------- */

function platformOf(host) {
  if (host === 'gitee.com') return 'gitee';
  if (host === 'github.com') return 'github';
  if (host === 'atomgit.com') return 'atomgit';
  return null;
}

/** 该平台能否运行本仓库的 CI 流水线（决定谁替无 CI 平台代执行同步） */
const CI_CAPABLE = { gitee: true, github: true, atomgit: false };

function platformLabel(platform) {
  return { gitee: 'Gitee', github: 'GitHub', atomgit: 'AtomGit' }[platform] || platform;
}

function tokenEnvHint(platform) {
  return {
    gitee: 'GITEE_TOKEN（Gitee 私人令牌，需 projects 权限）',
    github: 'GITHUB_TOKEN（需 issues 与 contents 写权限）',
    atomgit: 'ATOMGIT_TOKEN（AtomGit 访问令牌）',
  }[platform];
}

/**
 * 解析仓库标识。支持：
 *   gitee.com/owner/repo、https://gitee.com/owner/repo(.git)、
 *   git@gitee.com:owner/repo.git、ssh://git@gitee.com/owner/repo
 */
function parseRepoRef(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/\/+$/, '');
  if (s.endsWith('.git')) s = s.slice(0, -4);

  let m = s.match(/^git@([^:/]+):(.+)$/); // scp 语法
  if (m) return build(m[1], m[2]);
  m = s.match(/^(?:https?|ssh):\/\/(?:[^/@]+@)?([^/]+)\/(.+)$/i);
  if (m) return build(m[1], m[2]);
  m = s.match(/^([a-z0-9.-]+\.[a-z]{2,})\/(.+)$/i); // 裸 host/owner/repo
  if (m) return build(m[1], m[2]);
  return null;

  function build(host, path) {
    const segs = path.split('/').filter(Boolean);
    if (segs.length < 2) return null;
    const info = {
      host: host.toLowerCase(),
      owner: segs[0],
      repo: segs[1],
      key: `${host}/${segs[0]}/${segs[1]}`.toLowerCase(),
      platform: platformOf(host.toLowerCase()),
    };
    return info;
  }
}

function detectCurrentRepo() {
  const explicit = parseRepoRef(process.env.MIRROR_SYNC_CURRENT_REPO);
  if (explicit) return explicit;
  if (process.env.GITHUB_REPOSITORY) {
    const fromCi = parseRepoRef(`github.com/${process.env.GITHUB_REPOSITORY}`);
    if (fromCi) return fromCi;
  }
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const fromGit = parseRepoRef(url);
    if (fromGit) return fromGit;
  } catch {
    // 无 git 或无 origin remote，走调用方的错误提示
  }
  return null;
}

/* ---------- HTTP 基础设施 ---------- */

async function request(url, options = {}, { retries = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, redirect: 'manual' });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        await res.arrayBuffer().catch(() => {});
        if (attempt === retries) return res;
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : attempt * 2000);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      await sleep(attempt * 2000);
    }
  }
  throw lastError;
}

async function apiError(prefix, res) {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    // 忽略读取失败
  }
  const hint =
    res.status === 401 || res.status === 403
      ? '（令牌缺失或权限不足）'
      : res.status === 404
        ? '（仓库不存在、私有且未提供令牌，或接口路径不适用）'
        : '';
  return new Error(`${prefix}: HTTP ${res.status} ${hint} ${detail}`.trim());
}

function mimeOf(filename) {
  return MIME_TYPES[extname(filename).toLowerCase()] || 'application/octet-stream';
}

/** 下载资产到临时文件（手动跟随重定向，重定向后的签名 URL 不再携带令牌）。 */
async function downloadToTempFile(assetUrl, platform, token) {
  let firstUrl = assetUrl;
  if ((platform === 'gitee' || platform === 'atomgit') && token) {
    firstUrl += (firstUrl.includes('?') ? '&' : '?') + `access_token=${encodeURIComponent(token)}`;
  }
  const tryAuth = platform === 'github' && token;

  let res = await request(firstUrl, tryAuth ? { headers: { Authorization: `Bearer ${token}` } } : {});
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (location) {
      await res.body?.cancel?.().catch(() => {});
      res = await request(location, {}); // 签名 URL，匿名访问
    }
  }
  if (!res.ok && !tryAuth) {
    throw await apiError(`下载附件 ${assetUrl}`, res);
  }
  if (!res.ok) {
    // 带 Authorization 的直连失败，匿名重试一次（公开仓库 / 可匿名访问的 CDN）
    res = await request(assetUrl, {});
    if (!res.ok) throw await apiError(`下载附件 ${assetUrl}`, res);
  }

  const dir = await mkdtemp(join(tmpdir(), 'mirror-sync-'));
  const filePath = join(dir, 'asset');
  await streamPipeline(Readable.fromWeb(res.body), createWriteStream(filePath));
  const { size } = await stat(filePath);
  if (size === 0) throw new Error(`下载附件 ${assetUrl} 结果为空`);
  return { dir, filePath };
}

/* ---------- Gitee API v5 客户端 ---------- */

function createGiteeClient(repo, token) {
  const base = 'https://gitee.com/api/v5';
  const tokenEnvName = 'GITEE_TOKEN';

  const withToken = (params = {}) => {
    const search = new URLSearchParams(params);
    if (token) search.set('access_token', token);
    return search;
  };

  async function api(method, path, params = {}) {
    const url = new URL(base + path);
    if (method === 'GET') {
      withToken(params).forEach((value, key) => url.searchParams.set(key, value));
      const res = await request(url.toString(), { method });
      if (!res.ok) throw await apiError(`Gitee ${method} ${path}`, res);
      return res.json();
    }
    const res = await request(url.toString(), { method, body: withToken(params) });
    if (!res.ok) throw await apiError(`Gitee ${method} ${path}`, res);
    return res.json();
  }

  return {
    platform: 'gitee',
    tokenEnvName,
    token,

    async listIssues() {
      const raw = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const arr = await api('GET', `/repos/${repo.owner}/${repo.repo}/issues`, {
          state: 'all',
          per_page: PAGE_SIZE,
          page,
        });
        raw.push(...arr);
        if (arr.length < PAGE_SIZE) break;
      }
      return raw
        .map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body || '',
          state: i.state === 'closed' ? 'closed' : 'open', // progressing 视为 open
          labels: (i.labels || []).map((l) => l.name),
          createdAt: i.created_at || '',
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async createIssue({ title, body, labels }) {
      const payload = { title, body: body || '' };
      if (labels.length) payload.labels = labels.join(',');
      // Gitee v5 官方路径为 /repos/{owner}/issues（repo 放表单里），
      // 兼容另一种 /repos/{owner}/{repo}/issues 形态
      try {
        return await api('POST', `/repos/${repo.owner}/issues`, { ...payload, repo: repo.repo });
      } catch (error) {
        return await api('POST', `/repos/${repo.owner}/${repo.repo}/issues`, payload);
      }
    },

    async updateIssueState(number, state, title) {
      const extra = title ? { title } : {};
      try {
        return await api('PATCH', `/repos/${repo.owner}/issues/${number}`, {
          repo: repo.repo,
          state,
          ...extra,
        });
      } catch (error) {
        return await api('PATCH', `/repos/${repo.owner}/${repo.repo}/issues/${number}`, {
          state,
          ...extra,
        });
      }
    },

    async listReleases() {
      const raw = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const arr = await api('GET', `/repos/${repo.owner}/${repo.repo}/releases`, {
          per_page: PAGE_SIZE,
          page,
        });
        raw.push(...arr);
        if (arr.length < PAGE_SIZE) break;
      }
      return raw.map((r) => ({
        id: r.id,
        tagName: r.tag_name,
        name: r.name || r.tag_name,
        body: r.body || '',
        prerelease: Boolean(r.prerelease),
        assets: (r.assets || [])
          .filter((a) => a.browser_download_url && !isAutoArchive(a.browser_download_url))
          .map((a) => ({ name: a.name, url: a.browser_download_url })),
      }));
    },

    async createRelease({ tagName, name, body, prerelease }) {
      return api('POST', `/repos/${repo.owner}/${repo.repo}/releases`, {
        tag_name: tagName,
        name,
        body: body || '',
        prerelease: String(Boolean(prerelease)),
      });
    },

    async uploadAsset(release, fileName, filePath) {
      const fileBuffer = await readFile(filePath);
      const form = new FormData();
      if (token) form.append('access_token', token);
      form.append('file', new Blob([fileBuffer], { type: mimeOf(fileName) }), fileName);
      const res = await request(
        `${base}/repos/${repo.owner}/${repo.repo}/releases/${release.id}/attach_files`,
        { method: 'POST', body: form },
      );
      if (!res.ok) throw await apiError(`Gitee 上传附件 ${fileName}`, res);
      return res.json();
    },
  };
}

/* ---------- GitHub API 客户端 ---------- */

function createGithubClient(repo, token) {
  const base = 'https://api.github.com';
  const uploads = 'https://uploads.github.com';
  const tokenEnvName = 'GITHUB_TOKEN';

  const headers = (extra = {}) => {
    const h = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'svp-mirror-sync',
      ...extra,
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  async function api(method, path, body) {
    const res = await request(base + path, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await apiError(`GitHub ${method} ${path}`, res);
    return res.json();
  }

  /** 逐页拉取列表；跟随 Link: rel="next"。大仓库超过分页上限(422)时用已取到的数据降级。 */
  async function apiGetAll(path) {
    const out = [];
    let url = base + path;
    for (let i = 0; i < MAX_PAGES && url; i++) {
      const res = await request(url, { method: 'GET', headers: headers() });
      if (res.status === 422 && out.length) {
        warn('GitHub 分页上限已到（422），仅同步已获取的部分列表。');
        break;
      }
      if (!res.ok) throw await apiError(`GitHub GET ${path}`, res);
      out.push(...(await res.json()));
      url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
    }
    return out;
  }

  return {
    platform: 'github',
    tokenEnvName,
    token,

    async listIssues() {
      const raw = (await apiGetAll(`/repos/${repo.owner}/${repo.repo}/issues?state=all&per_page=${PAGE_SIZE}`))
        .filter((i) => !i.pull_request); // issues 接口会混入 PR
      return raw
        .map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body || '',
          state: i.state === 'closed' ? 'closed' : 'open',
          labels: (i.labels || []).map((l) => l.name),
          createdAt: i.created_at || '',
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async createIssue({ title, body, labels }) {
      const payload = { title, body: body || '' };
      if (labels.length) payload.labels = labels;
      return api('POST', `/repos/${repo.owner}/${repo.repo}/issues`, payload);
    },

    async updateIssueState(number, state) {
      return api('PATCH', `/repos/${repo.owner}/${repo.repo}/issues/${number}`, { state });
    },
    async listReleases() {
      const raw = await apiGetAll(`/repos/${repo.owner}/${repo.repo}/releases?per_page=${PAGE_SIZE}`);
      return raw.map((r) => ({
        id: r.id,
        tagName: r.tag_name,
        name: r.name || r.tag_name,
        body: r.body || '',
        prerelease: Boolean(r.prerelease),
        assets: (r.assets || [])
          .filter((a) => a.browser_download_url && !isAutoArchive(a.browser_download_url))
          .map((a) => ({ name: a.name, url: a.browser_download_url })),
      }));
    },

    async createRelease({ tagName, name, body, prerelease }) {
      return api('POST', `/repos/${repo.owner}/${repo.repo}/releases`, {
        tag_name: tagName,
        name,
        body: body || '',
        prerelease: Boolean(prerelease),
      });
    },

    async uploadAsset(release, fileName, filePath) {
      const fileBuffer = await readFile(filePath);
      const res = await request(
        `${uploads}/repos/${repo.owner}/${repo.repo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`,
        {
          method: 'POST',
          headers: headers({ 'Content-Type': mimeOf(fileName) }),
          body: fileBuffer,
        },
      );
      if (!res.ok) throw await apiError(`GitHub 上传附件 ${fileName}`, res);
      return res.json();
    },
  };
}

/* ---------- AtomGit API v5 客户端（与 Gitee v5 同源方言，JSON 请求体） ----------
 * atomgit.com 不提供流水线，作为镜像时由其他平台的流水线通过本客户端远程写入。
 * 附件上传为两步式：先 GET /releases/{tag}/upload_url 获取 OBS 预签名地址与请求头，
 * 再 PUT 文件到该地址。issue 创建/更新的 body、title 为必填，state 取值 reopen/close。
 */
function createAtomgitClient(repo, token) {
  const base = 'https://api.atomgit.com/api/v5';
  const tokenEnvName = 'ATOMGIT_TOKEN';

  async function api(method, path, params = {}, jsonBody = undefined) {
    const url = new URL(base + path);
    if (token) url.searchParams.set('access_token', token);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const init = { method, headers: {} };
    if (jsonBody !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(jsonBody);
    }
    const res = await request(url.toString(), init);
    if (!res.ok) throw await apiError(`AtomGit ${method} ${path}`, res);
    return res.json();
  }

  return {
    platform: 'atomgit',
    tokenEnvName,
    token,

    async listIssues() {
      const raw = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const arr = await api('GET', `/repos/${repo.owner}/${repo.repo}/issues`, {
          state: 'all',
          per_page: PAGE_SIZE,
          page,
        });
        raw.push(...arr);
        if (arr.length < PAGE_SIZE) break;
      }
      return raw
        .map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body || '',
          state: i.state === 'closed' ? 'closed' : 'open', // progressing 等中间态视为 open
          labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
          createdAt: i.created_at || '',
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async createIssue({ title, body, labels }) {
      const payload = { repo: repo.repo, title, body: body || title }; // body 必填
      if (labels.length) payload.labels = labels.join(',');
      return api('POST', `/repos/${repo.owner}/issues`, {}, payload);
    },

    async updateIssueState(number, state, title) {
      const payload = { repo: repo.repo, title: title || '', state: state === 'closed' ? 'close' : 'reopen' };
      return api('PATCH', `/repos/${repo.owner}/issues/${number}`, {}, payload);
    },

    async listReleases() {
      const raw = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const arr = await api('GET', `/repos/${repo.owner}/${repo.repo}/releases`, {
          per_page: PAGE_SIZE,
          page,
        });
        raw.push(...arr);
        if (arr.length < PAGE_SIZE) break;
      }
      return raw.map((r) => ({
        id: r.id,
        tagName: r.tag_name,
        name: r.name || r.tag_name,
        body: r.body || '',
        prerelease: Boolean(r.prerelease) || r.release_status === 'pre',
        assets: (r.assets || [])
          .filter((a) => a.browser_download_url && !isAutoArchive(a.browser_download_url))
          .map((a) => ({ name: a.name, url: a.browser_download_url })),
      }));
    },

    async createRelease({ tagName, name, body, prerelease }) {
      return api(
        'POST',
        `/repos/${repo.owner}/${repo.repo}/releases`,
        {},
        {
          tag_name: tagName,
          name,
          body: body || name, // body 必填
          release_status: prerelease ? 'pre' : 'latest',
        },
      );
    },

    async uploadAsset(release, fileName, filePath) {
      const { url, headers: putHeaders } = await api(
        'GET',
        `/repos/${repo.owner}/${repo.repo}/releases/${encodeURIComponent(release.tagName)}/upload_url`,
        { file_name: fileName },
      );
      if (!url) throw new Error(`AtomGit 未返回附件上传地址（${fileName}）`);
      const fileBuffer = await readFile(filePath);
      const res = await request(url, {
        method: 'PUT',
        headers: putHeaders || {},
        body: fileBuffer,
      });
      if (!res.ok) throw await apiError(`AtomGit 上传附件 ${fileName}`, res);
      return res.json().catch(() => ({}));
    },
  };
}

/* ---------- 同步逻辑 ---------- */

function normalizeTitle(title) {
  return String(title || '').trim();
}

async function syncIssues(primaryApi, currentApi, summary) {
  log('\n== 同步 Issue ==');
  const [primaryIssues, currentIssues] = await Promise.all([
    primaryApi.listIssues(),
    currentApi.listIssues(),
  ]);
  const currentByTitle = new Map(currentIssues.map((i) => [normalizeTitle(i.title), i]));
  log(`主仓库 issue：${primaryIssues.length} 个；当前仓库 issue：${currentIssues.length} 个`);

  for (const issue of primaryIssues) {
    const title = normalizeTitle(issue.title);
    const existing = currentByTitle.get(title);
    try {
      if (!existing) {
        if (DRY_RUN) {
          log(`[dry-run] 将创建 issue「${title}」（状态 ${issue.state}）`);
        } else {
          const created = await currentApi.createIssue({
            title,
            body: issue.body,
            labels: issue.labels,
          });
          log(`已创建 issue「${title}」#${created.number ?? ''}`);
          if (issue.state === 'closed') {
            await currentApi.updateIssueState(created.number, 'closed', title);
            log(`  并关闭（与主仓库状态一致）`);
          }
        }
        summary.issuesCreated++;
      } else if (existing.state !== issue.state) {
        if (DRY_RUN) {
          log(`[dry-run] 将把 issue「${title}」状态 ${existing.state} → ${issue.state}`);
        } else {
          await currentApi.updateIssueState(existing.number, issue.state, title);
          log(`已更新 issue「${title}」状态 ${existing.state} → ${issue.state}`);
        }
        summary.issuesStateUpdated++;
      }
    } catch (error) {
      summary.errors.push(`issue「${title}」: ${error.message}`);
      warn(`同步 issue「${title}」失败：${error.message}`);
    }
  }
}

async function syncReleases(primaryApi, currentApi, summary) {
  log('\n== 同步 Release ==');
  const [primaryReleases, currentReleases] = await Promise.all([
    primaryApi.listReleases(),
    currentApi.listReleases(),
  ]);
  const currentByTag = new Map(currentReleases.map((r) => [r.tagName, r]));
  log(`主仓库 release：${primaryReleases.length} 个；当前仓库 release：${currentReleases.length} 个`);

  for (const release of primaryReleases) {
    const tag = release.tagName;
    // 自动源码包在客户端层已过滤，这里再兜底一次（见 isAutoArchive）
    const primaryAssets = release.assets.filter((a) => !isAutoArchive(a.url));
    const existing = currentByTag.get(tag);
    try {
      let target = existing;
      if (!existing) {
        if (DRY_RUN) {
          log(
            `[dry-run] 将创建 release「${tag}」（${primaryAssets.length} 个附件：${primaryAssets.map((a) => a.name).join('、') || '无'}）`,
          );
          summary.releasesCreated++;
          continue;
        }
        const created = await currentApi.createRelease({
          tagName: tag,
          name: release.name,
          body: release.body,
          prerelease: release.prerelease,
        });
        target = { id: created.id, tagName: tag, assets: [] };
        log(`已创建 release「${tag}」(id ${created.id})`);
        summary.releasesCreated++;
      } else if (!primaryAssets.length) {
        continue;
      }

      const existingNames = new Set(
        target.assets.filter((a) => !isAutoArchive(a.url)).map((a) => a.name),
      );
      const missing = primaryAssets.filter((a) => !existingNames.has(a.name));
      if (!missing.length) continue;
      if (DRY_RUN) {
        log(`[dry-run] 将为 release「${tag}」补充附件：${missing.map((a) => a.name).join('、')}`);
        summary.assetsUploaded += missing.length;
        continue;
      }

      for (const asset of missing) {
        let download;
        try {
          download = await downloadToTempFile(asset.url, primaryApi.platform, primaryApi.token);
          await currentApi.uploadAsset(target, asset.name, download.filePath);
          log(`  已上传附件 ${asset.name} → release「${tag}」`);
          summary.assetsUploaded++;
        } finally {
          if (download) await rm(download.dir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch (error) {
      summary.errors.push(`release「${tag}」: ${error.message}`);
      warn(`同步 release「${tag}」失败：${error.message}`);
    }
  }
}

/* ---------- 入口 ---------- */

function createClient(repoInfo, tokens) {
  if (repoInfo.platform === 'gitee') return createGiteeClient(repoInfo, tokens.gitee);
  if (repoInfo.platform === 'github') return createGithubClient(repoInfo, tokens.github);
  if (repoInfo.platform === 'atomgit') return createAtomgitClient(repoInfo, tokens.atomgit);
  throw new Error(`${repoInfo.key} 所在平台 ${repoInfo.host} 暂不支持（支持 gitee.com / github.com / atomgit.com）`);
}

/**
 * 计算本次流水线要同步的目标：
 * - 自同步：当前仓库是镜像（且平台支持 CI）→ 从主仓库同步到当前仓库；
 * - 代同步：无 CI 平台（atomgit）的镜像无法自己触发流水线，
 *   由主仓库的流水线代为同步；若主仓库平台也无 CI，则由各镜像流水线代管。
 */
function planSyncTargets(parsedMirrors, current) {
  const primary = parsedMirrors[0];
  const others = parsedMirrors.slice(1);
  const ciless = others.filter((m) => m.key !== current.key && m.platform && !CI_CAPABLE[m.platform]);
  const selfSync = current.key !== primary.key; // 当前仓库是镜像 → 需要同步自己
  const primaryCapable = primary.platform ? Boolean(CI_CAPABLE[primary.platform]) : false;
  const adoptCiless =
    ciless.length &&
    (current.key === primary.key
      ? primaryCapable // 常规：主仓库流水线代推无 CI 镜像
      : !primaryCapable); // 主仓库也无 CI 时，由镜像流水线代管
  return { primary, selfSync, pushTargets: adoptCiless ? ciless : [] };
}

async function main() {
  log(`镜像同步${DRY_RUN ? '（dry-run，只打印计划）' : ''}`);

  let archive;
  try {
    archive = JSON.parse(await readFile(ARCHIVE_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`读取 ${ARCHIVE_PATH} 失败：${error.message}`);
  }

  const mirrors = Array.isArray(archive.mirrors) ? archive.mirrors : [];
  if (!mirrors.length) {
    log(`${ARCHIVE_PATH} 未配置 mirrors 字段，无需同步。`);
    return { summary: null, exitCode: 0 };
  }

  const parsedMirrors = mirrors.map(parseRepoRef);
  const primary = parsedMirrors[0];
  if (!primary) {
    throw new Error(`mirrors[0] 无法解析：${mirrors[0]}（期望形如 gitee.com/owner/repo）`);
  }
  const current = detectCurrentRepo();
  if (!current) {
    throw new Error(
      '无法识别当前仓库：请设置环境变量 MIRROR_SYNC_CURRENT_REPO（形如 github.com/owner/repo），或在含 origin remote 的仓库内运行。',
    );
  }

  log(`主仓库：${primary.key}`);
  log(`当前仓库：${current.key}`);

  if (!current.platform) {
    throw new Error(`当前仓库 ${current.key} 所在平台暂不支持（支持 gitee.com / github.com / atomgit.com）`);
  }
  if (!primary.platform) {
    throw new Error(`主仓库 ${primary.key} 所在平台暂不支持（支持 gitee.com / github.com / atomgit.com）`);
  }

  const { selfSync, pushTargets } = planSyncTargets(parsedMirrors, current);
  if (!selfSync && !pushTargets.length) {
    log('当前仓库即主仓库，且没有需要代为同步的无 CI 镜像，无需同步。');
    return { summary: null, exitCode: 0 };
  }

  const tokens = {
    gitee: process.env.GITEE_TOKEN || process.env.GITEE_ACCESS_TOKEN || '',
    github: process.env.GITHUB_TOKEN || '',
    atomgit: process.env.ATOMGIT_TOKEN || '',
  };

  const primaryApi = createClient(primary, tokens);
  const summary = { issuesCreated: 0, issuesStateUpdated: 0, releasesCreated: 0, assetsUploaded: 0, errors: [] };

  if (!tokens[primary.platform]) {
    warn(`未设置主仓库（${primary.host}）的访问令牌：主仓库为私有仓库或触发限流时将读取失败。`);
  }

  const targets = [];
  if (selfSync) {
    if (!tokens[current.platform]) {
      warn(`未设置 ${tokenEnvHint(current.platform)}：对当前仓库的写操作大概率会失败（401/403）。`);
    }
    targets.push(current);
  }
  for (const target of pushTargets) {
    if (!tokens[target.platform]) {
      warn(`未设置 ${tokenEnvHint(target.platform)}：代为同步 ${target.key} 的写操作大概率会失败（401/403）。`);
    }
    targets.push(target);
  }

  for (const target of targets) {
    if (targets.length > 1) log(`\n>>>> 同步目标：${target.key} <<<<`);
    const targetApi = createClient(target, tokens);
    await syncIssues(primaryApi, targetApi, summary);
    await syncReleases(primaryApi, targetApi, summary);
  }

  log('\n== 结果 ==');
  log(
    `创建 issue ${summary.issuesCreated} 个；状态更新 ${summary.issuesStateUpdated} 个；` +
      `创建 release ${summary.releasesCreated} 个；上传附件 ${summary.assetsUploaded} 个。`,
  );
  if (summary.errors.length) {
    warn(`共 ${summary.errors.length} 项失败：`);
    for (const e of summary.errors) warn(`  - ${e}`);
  }
  return { summary, exitCode: summary.errors.length ? 1 : 0 };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    const { exitCode } = await main();
    process.exitCode = exitCode;
  } catch (error) {
    console.error(`[错误] ${error.message}`);
    process.exitCode = 1;
  }
}

export {
  syncIssues,
  syncReleases,
  parseRepoRef,
  detectCurrentRepo,
  planSyncTargets,
  createAtomgitClient,
};

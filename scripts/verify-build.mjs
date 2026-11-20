import { renderMarkdown } from '../src/lib/markdown.ts';
import { cardHtml, detailHtml, safeHttpUrl } from '../src/lib/viewgen.ts';
import { readFileSync } from 'node:fs';
import { identifyLicenseText, normalizeLicenseText, sha256Hex } from '../src/lib/utils.ts';
import { LICENSE_FINGERPRINTS } from '../src/config.ts';
let fail = 0;
const check = (name, ok) => { console.log((ok ? 'OK  ' : 'FAIL ') + name); if (!ok) fail++; };
const TAG = String.fromCharCode(60) + 'script>alert(1)' + String.fromCharCode(60) + '/script>';
const IMG = String.fromCharCode(60) + 'img src=x onerror=alert(2)>';
const evil = '# t\n\n' + TAG + '\n\n' + IMG + '\n\n[l](java' + 'script:alert(3))\n\nb **bold**';
const out = await renderMarkdown(evil);
check('script-blocked', !out.includes(String.fromCharCode(60) + 'script'));
check('onerror-blocked', !out.includes('onerror'));
check('jsproto-blocked', !out.includes('script:alert'));
check('strong-kept', out.includes('bold'));

// ---- 共享生成器注入面（标题/属性值均为投稿者可控输入）----
const QUOTE = String.fromCharCode(34) + ' onmouseover=alert(9) x=' + String.fromCharCode(34);
const evilEntry = {
  slug: '260000-test', owner: 'a" onload=alert(1)', repo: 'r', platform: 'github',
  type: 'project', title: 'T' + QUOTE + '><img src=x onerror=alert(4)>',
  submittedAt: '2026-01-01T00:00:00.000Z',
  paramState: 'with-params', songs: ['s' + QUOTE], tags: ['<b>'],
};
const Q = String.fromCharCode(34);
// 转义有效性：payload 以 &quot;/&lt; 形态存在（数据合法），绝无裸引号逃逸或裸标签注入
const escapedOk = (html) =>
  !html.includes(Q + ' onmouseover') &&
  html.includes('&quot; onmouseover') &&
  !html.includes('<img');
const card = cardHtml(evilEntry, { locale: 'zh-Hans', href: '#/post/x', coverUrl: null });
check('card-attr-escaped', escapedOk(card));
check('card-tag-escaped', !card.includes('<b>'));
const parsedEmpty = { attrs: { title: 't', videos: 'java' + 'script:alert(5),https://ok.example/v' }, body: '', files: [] };
const detail = detailHtml(
  {
    entry: evilEntry, parsed: parsedEmpty, bodyHtml: out, coverUrl: null, media: [],
    licenseId: null, sourceRepoUrl: 'https://example.com/a/b', backHref: '/', fileUrl: (n) => '/f/' + n,
  },
  { locale: 'zh-Hans' },
);
check('detail-title-escaped', !detail.includes(Q + ' onmouseover') && detail.includes('&quot; onmouseover'));
check('detail-videos-filtered', !detail.includes('script:alert') && detail.includes('https://ok.example/v'));
check('safeHttpUrl-rejects', safeHttpUrl('java' + 'script:alert(1)') === null && safeHttpUrl('https://a.example/') === 'https://a.example/');

const lic = readFileSync('LICENSE', 'utf8');
const sha = await sha256Hex(normalizeLicenseText(lic));
const id = await identifyLicenseText(lic);
console.log('local sha=' + sha.slice(0, 16));
console.log('table sha=' + (LICENSE_FINGERPRINTS.find((f) => f.id === 'CC-BY-4.0') || {}).sha256?.slice(0, 16));
check('license-id', !!id);
process.exit(fail ? 1 : 0);

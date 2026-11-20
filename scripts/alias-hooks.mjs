import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve as pResolve, dirname } from 'node:path';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const hasExt = (s) => /\.[a-z0-9]+$/i.test(s);
function tryPaths(base) {
  for (const candidate of [base + '.ts', pResolve(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
export async function resolve(specifier, context, next) {
  // @/ 别名 → src/ 下文件或目录模块
  if (specifier.startsWith('@/')) {
    const target = tryPaths(pResolve(ROOT, 'src', specifier.slice(2)));
    if (target) return next(pathToFileURL(target).href, context);
  }
  // 相对导入缺扩展名（Vite 风格源码，裸 node 需补 .ts / index.ts）
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !hasExt(specifier) && context.parentURL) {
    const target = tryPaths(pResolve(dirname(fileURLToPath(context.parentURL)), specifier));
    if (target) return next(pathToFileURL(target).href, context);
  }
  return next(specifier, context);
}

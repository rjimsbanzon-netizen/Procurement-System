/** Read-only release checks. Does not call the production API or touch D1. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const failures = [];
const warnings = [];
const pass = message => console.log(`PASS  ${message}`);
const fail = message => { failures.push(message); console.error(`FAIL  ${message}`); };
const warn = message => { warnings.push(message); console.warn(`WARN  ${message}`); };

if (!existsSync(join(dist, 'index.html'))) {
  fail('dist/index.html is missing; run npm run build first');
} else {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const expectedBase = process.env.GITHUB_ACTIONS === 'true' ? '/Procurement-System/' : '/';
  const links = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
  for (const link of links) {
    if (/^(?:https?:|data:|mailto:|#)/i.test(link)) continue;
    if (!link.startsWith(expectedBase)) {
      fail(`Built asset path ${link} does not start with ${expectedBase}`); continue;
    }
    const path = join(dist, link.slice(expectedBase.length).split(/[?#]/, 1)[0]);
    if (!existsSync(path)) fail(`Missing built resource: ${link}`);
  }
  if (links.some(link => link.includes('/assets/'))) pass('Built HTML references existing fingerprinted assets');
  else fail('No fingerprinted asset references found in index.html');
  if (!html.includes('manifest.webmanifest')) fail('Install manifest is missing from built HTML');
  else pass('PWA manifest is linked from built HTML');
}
const manifestPath = join(dist,'manifest.webmanifest');
if (!existsSync(manifestPath)) fail('PWA manifest not bundled');
else {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.start_url !== './?source=pwa' || manifest.scope !== './') fail('PWA start URL or scope is not repository-relative');
    else pass('PWA URLs are repository-relative');
    for (const icon of manifest.icons || []) {
      if (!existsSync(join(dist, icon.src.replace(/^\.\//,'')))) fail(`Missing PWA icon: ${icon.src}`);
    }
  } catch (error) { fail(`Invalid PWA manifest: ${error.message}`); }
}
if (!existsSync(join(dist, 'sw.js'))) fail('Missing service worker');
else pass('Service worker included');
const assetsDir = join(dist, 'assets');
if (existsSync(assetsDir)) {
  const jsAssets = readdirSync(assetsDir).filter(name => name.endsWith('.js'))
    .map(name => ({name, size: statSync(join(assetsDir,name)).size}));
  const largest = jsAssets.reduce((largest, next) => next.size > largest.size ? next : largest, {name:'',size:0});
  if (largest.size > 650_000) warn(`Largest JS chunk: ${largest.name} (${(largest.size/1024).toFixed(0)} KiB). Review code splitting.`);
  else pass(`Largest JS chunk: ${(largest.size/1024).toFixed(0)} KiB`);
  const logos = readdirSync(assetsDir).filter(name => /procureflow-mark.*\.(png|webp)$/i.test(name));
  if (!logos.some(name=>name.endsWith('.webp'))) warn('Optimized logo was not found in the built asset directory');
  if (logos.some(name=>statSync(join(assetsDir,name)).size > 200_000)) fail('An oversized logo is still in the production bundle');
  else pass('Logo is optimized in the production bundle');
}
console.log(`\nRelease checks: ${failures.length} failures, ${warnings.length} warnings.`);
if (failures.length) process.exitCode = 1;

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

for (const scope of ['https://example.test/', 'https://example.test/Procurement-System/']) {
  test(`manifest and service worker resolve inside ${scope}`, async () => {
    const manifestUrl = new URL('manifest.webmanifest', scope);
    assert.equal(new URL(manifest.start_url, manifestUrl).pathname, new URL(scope).pathname);
    assert.equal(new URL(manifest.scope, manifestUrl).pathname, new URL(scope).pathname);
    for (const icon of manifest.icons) assert.ok(new URL(icon.src,manifestUrl).pathname.startsWith(new URL(scope).pathname));
    const events = new Map();
    let cachedUrls=[];
    const cache={addAll:async urls=>{cachedUrls=urls;},put:async()=>{}};
    const self={
      registration:{scope},
      location:{origin:new URL(scope).origin},
      skipWaiting:async()=>{},clients:{claim:async()=>{}},
      addEventListener:(name,callback)=>events.set(name,callback),
    };
    vm.runInNewContext(swSource,{self, URL, caches:{open:async()=>cache,keys:async()=>[]},fetch:async()=>({ok:true,type:'basic'}),Response}, {filename:'sw.js'});
    let installed;
    events.get('install')({waitUntil:promise=>{installed=promise;}});
    await installed;
    assert.equal(cachedUrls.length,5);
    for (const url of cachedUrls) assert.ok(url.startsWith(scope),`Unscoped cache entry: ${url}`);
    assert.ok(cachedUrls.includes(new URL('index.html',scope).href));
    let responded=false;
    events.get('fetch')({request:{method:'GET',url:new URL('private-documents',scope).href,mode:'cors'},respondWith:()=>{responded=true;}});
    assert.equal(responded,false,'Private records must not be cached');
  });
}
test('index.html resolves PWA links through Vite base URL',()=>{
  for(const name of ['manifest.webmanifest','pwa-192.png']) {
    assert.match(html, new RegExp('%BASE_URL%'+name.replace('.','\\.')));
  }
});

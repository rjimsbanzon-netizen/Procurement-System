import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read = rel => readFileSync(resolve(root,rel),'utf8');

test('Phase 6 loads authorized page components on demand',()=>{
  const app=read('src/App.tsx');
  const imports=[...app.matchAll(/const (\w+) = lazy\(\(\) => import\('(\.\/[^']+)'\)\);/g)];
  assert.equal(imports.length,35,'Expected all 35 application page modules to be lazy');
  const names=new Set();
  for(const [,name,path] of imports){
    assert.ok(!names.has(name),`Duplicate lazy page ${name}`); names.add(name);
    assert.ok(existsSync(resolve(root,'src',path.slice(2)+'.tsx')),`Missing lazy page source ${path}`);
    assert.match(app,new RegExp(`<${name}\\s*/>`),`No render route for ${name}`);
  }
  assert.ok(app.includes('<Suspense fallback='),'Lazy routes must show a loading state');
  assert.ok(app.includes('canAccessTab(ui.currentTab)'),'Permissions must still gate access before page rendering');
});

test('Phase 6 uses optimized brand image in navigation and auth',()=>{
  const image=resolve(root,'src/procureflow-mark.webp');
  assert.ok(existsSync(image));
  const header=readFileSync(image).subarray(0,12);
  assert.equal(header.subarray(0,4).toString(),'RIFF');
  assert.equal(header.subarray(8,12).toString(),'WEBP');
  assert.ok(statSync(image).size < 100_000,'Header logo exceeds 100 KB');
  for(const rel of ['src/components/Header.tsx','src/components/Sidebar.tsx','src/views/auth.ts']){
    assert.match(read(rel),/procureflow-mark\.webp/);
  }
});

test('Phase 6 permits a full reload after module loading failure',()=>{
  const code=read('src/components/PageErrorBoundary.tsx');
  assert.match(code,/window\.location\.reload\(\)/);
  assert.match(code,/Retry module/);
});


test('Phase 6 reduces repeated role-refresh traffic without losing focus updates',()=>{
  const code=read('src/components/Header.tsx');
  assert.match(code,/setInterval\(\(\)=>\{void refresh\(\);\},15_000\)/);
  assert.match(code,/window\.addEventListener\('focus',onFocus\)/);
  assert.match(code,/visibilitychange/);
});

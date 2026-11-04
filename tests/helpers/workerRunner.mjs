/** Load the ACTUAL Worker handlers for in-process HTTP tests without Wrangler.
 * TypeScript transpilation rewrites only import extensions in temporary files;
 * source modules and migrations are the same ones deployed in production.
 */
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

export async function loadWorkerForTests() {
  const dir = await mkdtemp(join(tmpdir(), 'procureflow-worker-test-'));
  try {
    const entries = (await readdir(join(root,'cloudflare','src'))).filter(file=>file.endsWith('.ts'));
    for (const entry of entries) {
      let source=await readFile(join(root,'cloudflare','src',entry),'utf8');
      // Rewrite bare relative file imports. The Worker itself remains unmodified.
      source = source.replace(/(from\s*['"])(\.\/[^'"]+)(['"])/g,(_,a,b,c)=>a+b.replace(/\.ts$/,'')+'.mjs'+c);
      const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true}}).outputText;
      await writeFile(join(dir,entry.replace(/\.ts$/,'.mjs')),js);
    }
    const worker=(await import(pathToFileURL(join(dir,'index.mjs')).href)).default;
    return {worker,dispose:async()=>rm(dir,{recursive:true,force:true})};
  } catch (error) {await rm(dir,{recursive:true,force:true});throw error;}
}

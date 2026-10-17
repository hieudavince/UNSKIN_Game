// Bundles each test with esbuild (so it can import the app's ESM/JSX sources)
// and runs it with node. Usage: npm test  |  node tests/run.mjs mapCheck
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const all = ['mapCheck', 'bombCheck', 'wallCheck'];
const pick = process.argv.slice(2);
const tests = pick.length ? pick : all;
mkdirSync('tests/.out', { recursive: true });
let failed = 0;
for (const name of tests) {
  const outfile = `tests/.out/${name}.mjs`;
  await build({
    entryPoints: [`tests/${name}.js`],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'warning',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    jsx: 'automatic',
  });
  console.log(`\n=== ${name} ===`);
  const run = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  if (run.status !== 0) failed += 1;
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nall test files passed');
process.exit(failed ? 1 : 0);

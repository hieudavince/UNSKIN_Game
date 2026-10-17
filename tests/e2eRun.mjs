import { spawn } from 'node:child_process';

const [, , mode = 'DUEL', ranked = 'casual', count = '2'] = process.argv;
const players = Array.from({ length: Number(count) }, (_, i) => `Tester${i + 1}`);

const runs = players.map((name, index) => new Promise((resolve) => {
  setTimeout(() => {
    const child = spawn(process.execPath, ['tests/.out/e2ePlayer.mjs', name, mode, ranked], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => resolve({ name, code }));
  }, index * 1500);
}));

const results = await Promise.all(runs);
console.log(JSON.stringify({ results }));
process.exit(results.every((r) => r.code === 0) ? 0 : 1);

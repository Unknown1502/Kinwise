#!/usr/bin/env node
// Start the whole local demo with one command:
//   node scripts/dev.mjs              # hub, concierge (auto: Bedrock if available, else offline), Echo sim, TV preview
//   node scripts/dev.mjs --offline    # no AWS needed
//   node scripts/dev.mjs --ring live  # also run the Ring worker against the Ring Developer Playground
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const ringMode = args.includes('--ring') ? args[args.indexOf('--ring') + 1] ?? 'live' : null;
const isWin = process.platform === 'win32';

const services = [
  { name: 'hub', color: 32, cwd: '.', cmd: 'npm', args: ['run', 'dev', '-w', '@kinwise/hub'], env: {} },
  {
    name: 'concierge',
    color: 35,
    cwd: 'agents/concierge',
    cmd: 'uv',
    args: ['run', 'kinwise-concierge'],
    env: { CONCIERGE_MODE: offline ? 'offline' : process.env.CONCIERGE_MODE ?? 'auto' },
  },
  { name: 'echo', color: 36, cwd: 'packages/echo-sim', cmd: 'npm', args: ['run', 'dev'], env: {} },
  { name: 'tv', color: 33, cwd: 'packages/tv-preview', cmd: 'npm', args: ['run', 'dev'], env: {} },
];
if (ringMode) {
  services.push({ name: 'ring', color: 34, cwd: 'agents/ring-worker', cmd: 'uv', args: ['run', 'kinwise-ring', ringMode], env: {} });
}

const children = [];
for (const s of services) {
  // stdin must be 'ignore': `tsx watch` reads stdin for key commands and never starts the app when stdin is a pipe.
  const child = spawn(s.cmd, s.args, {
    cwd: join(root, s.cwd),
    env: { ...process.env, ...s.env },
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `\x1b[${s.color}m${s.name.padEnd(9)}\x1b[0m│ `;
  const pipe = (stream) => stream.on('data', (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(tag + l)));
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => console.log(`${tag}exited (${code})`));
  children.push(child);
}

console.log(`
  Kinwise local demo
  ──────────────────
  Echo Show simulator  http://localhost:5173
  Fire TV preview      http://localhost:5174/?hub=http://localhost:8787
  Hub / MCP endpoint   http://localhost:8787/mcp
  Concierge            http://localhost:8081  (${offline ? 'offline router' : 'auto: Bedrock → offline fallback'})
  Press Ctrl+C to stop everything.
`);

const stop = () => {
  for (const c of children) {
    if (isWin && c.pid) spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' });
    else c.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

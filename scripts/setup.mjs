#!/usr/bin/env node
// One-time setup: installs every package's dependencies. Works on Windows, macOS and Linux.
//   node scripts/setup.mjs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function run(label, cmd, args, cwd) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd: join(root, cwd), stdio: 'inherit', shell: isWin });
  if (r.status !== 0) {
    console.error(`✘ ${label} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function has(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: isWin }).status === 0;
}

if (!has('uv')) {
  console.error('uv is required for the Python agents: https://docs.astral.sh/uv/getting-started/installation/');
  process.exit(1);
}

run('Hub + infra (npm workspaces)', 'npm', ['install', '--no-audit', '--no-fund'], '.');
run('Echo Show simulator', 'npm', ['install', '--no-audit', '--no-fund'], 'packages/echo-sim');
run('Fire TV preview', 'npm', ['install', '--no-audit', '--no-fund'], 'packages/tv-preview');
run('Concierge agent (Python)', 'uv', ['sync'], 'agents/concierge');
run('Ring worker (Python)', 'uv', ['sync'], 'agents/ring-worker');

if (!existsSync(join(root, 'packages/hub/src/mcp/ui-bundle.generated.ts'))) {
  run('MCP Apps cards', 'npm', ['run', 'build:ui', '-w', '@kinwise/hub'], '.');
}
console.log('\n✔ Setup complete. Start everything with:  node scripts/dev.mjs\n');

#!/usr/bin/env node
// Print the hosted-demo persona tokens (derived from the DemoTokenSeed secret) for the judges' testing notes.
//   node scripts/demo-tokens.mjs [stack-name]       (needs AWS credentials for the deploying account)
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const stack = process.argv[2] ?? 'Kinwise';
const aws = (args) => execFileSync('aws', args, { encoding: 'utf8', shell: process.platform === 'win32' }).trim();

const outputs = JSON.parse(aws(['cloudformation', 'describe-stacks', '--stack-name', stack, '--query', 'Stacks[0].Outputs', '--output', 'json']));
const out = Object.fromEntries(outputs.map((o) => [o.OutputKey, o.OutputValue]));
const secret = JSON.parse(aws(['secretsmanager', 'get-secret-value', '--secret-id', out.DemoTokenSeedArn, '--query', 'SecretString', '--output', 'text']));
const derive = (persona) => `kw_${persona}_${createHmac('sha256', secret.seed).update(`kinwise-demo:${persona}`).digest('base64url').slice(0, 32)}`;

console.log(`
Hub:            ${out.ApiUrl}
MCP endpoint:   ${out.McpEndpoint}
Asha (resident) ${derive('asha')}
Priya (family)  ${derive('priya')}
Living-room TV  ${derive('tv')}

Echo simulator: VITE_HUB_URL=${out.ApiUrl} VITE_ASHA_TOKEN=<Asha> VITE_PRIYA_TOKEN=<Priya> npm run dev
TV preview:     http://localhost:5174/?hub=${out.ApiUrl}&token=<TV>
`);

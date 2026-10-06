#!/usr/bin/env node
import { runConformance, summarize } from './conformance.js';

const ICON = { pass: '✔', warn: '!', fail: '✘', skip: '–' } as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = arg('url') ?? process.env.MCP_URL;
  const userToken = arg('token') ?? process.env.MCP_USER_TOKEN;
  if (!url || !userToken || process.argv.includes('--help')) {
    console.log(`Usage: alexa-mcp-conformance --url <https://host/mcp> --token <user token> [--service-token <token>] [--protocol 2025-11-25]

Checks a self-hosted MCP server against the Alexa+ add-on contract: protocol version over Streamable HTTP,
RFC 9728 metadata, 401 without WWW-Authenticate, Origin 403, two-tier scopes, output schemas, annotations,
MCP Apps UI resources and the 500 ms latency budget.`);
    process.exit(url && userToken ? 0 : 2);
  }
  console.log(`\nAlexa+ MCP conformance — ${url}\n`);
  const results = await runConformance({
    url,
    userToken,
    serviceToken: arg('service-token') ?? process.env.MCP_SERVICE_TOKEN,
    protocolVersion: arg('protocol'),
  });
  for (const r of results) console.log(`  ${ICON[r.status]} ${r.title}${r.detail ? `  — ${r.detail}` : ''}`);
  const s = summarize(results);
  console.log(`\n${s.passed} passed · ${s.warned} warnings · ${s.failed} failed · ${s.skipped} skipped\n`);
  process.exit(s.failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

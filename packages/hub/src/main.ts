import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app } = await bootstrap(config);

// Demo media (e.g. Priya's recorded Pause message) for local runs. On AWS this lives on S3/CloudFront.
app.use('/media/*', serveStatic({ root: './' }));

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`\n  Kinwise hub  →  http://localhost:${info.port}`);
  console.log(`  MCP endpoint →  http://localhost:${info.port}/mcp   (protocol 2025-11-25, Streamable HTTP)`);
  console.log(`  Auth mode    →  ${config.authMode}${config.authMode === 'dev' ? '   (tokens: dev-asha, dev-priya, dev-service, dev-tv)' : ''}`);
  console.log(`  Store        →  ${config.store}${config.store === 'file' ? ` (${config.dataFile})` : ''}\n`);
});

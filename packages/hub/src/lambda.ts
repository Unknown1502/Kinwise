import { handle } from 'hono/aws-lambda';
import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';

// Built once per container (cold start), reused across invocations.
const ready = bootstrap(loadConfig());

export const handler = async (event: Parameters<ReturnType<typeof handle>>[0], context: Parameters<ReturnType<typeof handle>>[1]) => {
  const { app } = await ready;
  return handle(app)(event, context);
};

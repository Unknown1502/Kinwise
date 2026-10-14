import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';
import { makeHandler } from './handler.js';

// Built once per container (cold start), reused across invocations.
export const handler = makeHandler(bootstrap(loadConfig()));

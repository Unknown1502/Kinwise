import { handle } from 'hono/aws-lambda';
import type { bootstrap } from './bootstrap.js';

type Hub = Awaited<ReturnType<typeof bootstrap>>;
type ApiEvent = Parameters<ReturnType<typeof handle>>[0];
type Ctx = Parameters<ReturnType<typeof handle>>[1];

/**
 * Two kinds of caller: API Gateway (a web request) and EventBridge Scheduler, which invokes this function
 * directly with the JSON we gave it when we scheduled the follow-up. A Scheduler event has `source` at the top
 * level; an API Gateway event never does (a request body is a string inside `body`, so nobody can fake it from outside),
 * and only the Scheduler role is allowed to invoke the function directly.
 */
export function makeHandler(ready: Promise<Pick<Hub, 'app' | 'service'>>) {
  return async (event: ApiEvent | { source?: string; householdId?: string }, context: Ctx) => {
    const { app, service } = await ready;
    const e = event as { source?: unknown; householdId?: unknown; requestContext?: unknown };
    if (e.source === 'kinwise.followup' && !e.requestContext) {
      if (typeof e.householdId === 'string' && e.householdId) await service.followUp(e.householdId);
      return { ok: true };
    }
    return handle(app)(event as ApiEvent, context);
  };
}

import { handle } from 'hono/aws-lambda';
import type { bootstrap } from './bootstrap.js';

type Hub = Awaited<ReturnType<typeof bootstrap>>;
type ApiEvent = Parameters<ReturnType<typeof handle>>[0];
type Ctx = Parameters<ReturnType<typeof handle>>[1];

/**
 * Two kinds of caller: API Gateway (a web request) and EventBridge Scheduler, which invokes this function
 * directly with the JSON we gave it when we scheduled the follow-up. A Scheduler event has `source` at the top
 * level (an API Gateway event never does) and must carry a signature over its household and call, made with the hub's
 * own secret when the schedule was created. Without it, an event is refused even from a caller allowed to invoke the function.
 */
export function makeHandler(ready: Promise<Pick<Hub, 'app' | 'service' | 'verifyFollowUp'>>) {
  return async (event: ApiEvent | Record<string, unknown>, context: Ctx) => {
    const { app, service, verifyFollowUp } = await ready;
    const e = event as { source?: unknown; householdId?: unknown; callId?: unknown; sig?: unknown; requestContext?: unknown };
    if (e.source === 'kinwise.followup' && !e.requestContext) {
      if (typeof e.householdId !== 'string' || typeof e.callId !== 'string' || !verifyFollowUp(e.householdId, e.callId, e.sig)) {
        console.error('[followup] refused an event that is not signed for this call');
        return { ok: false };
      }
      await service.followUp(e.householdId, e.callId);
      return { ok: true };
    }
    return handle(app)(event as ApiEvent, context);
  };
}

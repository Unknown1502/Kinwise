/** Small display helpers (pure, unit-tested). */

/** Pretty JSON for the drawer; long strings (e.g. a card's 250 KB HTML) are shortened. */
export function prettyJson(value: unknown, maxString = 600): string {
  if (value === undefined) return '—';
  try {
    return JSON.stringify(
      value,
      (_k, v: unknown) => (typeof v === 'string' && v.length > maxString ? `${v.slice(0, maxString)}… (${v.length.toLocaleString('en-US')} chars)` : v),
      2,
    );
  } catch {
    return String(value);
  }
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function clockTime(at: number | Date): string {
  const d = typeof at === 'number' ? new Date(at) : at;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function logTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** ISO 8601 with the local UTC offset, e.g. 2026-10-05T14:00:00-04:00 (what kinwise_add_reminder expects). */
export function localIsoAt(base: Date, hour: number, minute = 0): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

/** Sample arguments for the "Run a tool directly" debug panel. */
export function sampleArgs(tool: string, now = new Date()): Record<string, unknown> {
  switch (tool) {
    case 'kinwise_check_call':
      return {
        description:
          "A man from the FTC called. He said my accounts are compromised, I should withdraw my savings as gold, a courier will come, and I shouldn't tell my family.",
      };
    case 'kinwise_add_reminder':
      return { text: 'Courier from the bank is picking up a package', at: localIsoAt(now, 14) };
    case 'kinwise_set_privacy_hour':
      return { minutes: 60 };
    case 'kinwise_add_expected_visit':
      return { label: 'Maria (nurse)', weekday: 'tuesday', start: '14:00', end: '15:00' };
    case 'kinwise_send_family_message':
      return { text: 'Dinner Sunday? ❤️' };
    case 'kinwise_respond_to_alert':
      return { alertId: '<from kinwise_get_today.activeAlert.id>', action: 'call_family' };
    default:
      return {};
  }
}

/** Human label for a tool name ("kinwise_respond_to_alert" → "respond to alert"). */
export function toolLabel(name: string): string {
  return name.replace(/^kinwise_/, '').replace(/_/g, ' ');
}

/** Short model label for the meta line. */
export function modelLabel(model: string): string {
  if (!model || model === 'unknown') return 'unknown model';
  if (model === 'offline-router') return 'offline router (no LLM)';
  const m = /claude-([a-z]+)-(\d+)-(\d+)/i.exec(model);
  if (m) return `Claude ${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}`;
  if (/nova/i.test(model)) return model.replace(/^.*?(nova[\w.-]*).*$/i, '$1');
  return model;
}

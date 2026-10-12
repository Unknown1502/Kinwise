import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderMarkdown, runScenarios } from '../src/eval/scenarios.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('scenario evaluation: Kinwise vs a door-only rule', () => {
  it('produces the outcome we promise for every situation', async () => {
    const { rows } = await runScenarios();
    const outcome = Object.fromEntries(rows.map((r) => [r.id, r.kinwise]));
    expect(outcome).toEqual({
      'scam-call-then-courier': 'Pause',
      'scam-reminder-then-courier': 'Pause',
      'delivery-no-call': 'Note',
      'neighbour-no-call': 'Note',
      'gardener-after-scam-call': 'Greeting',
      'aide-on-schedule': 'Greeting',
      'courier-after-window-expired': 'Note',
      'privacy-time': 'Quiet',
      'nobody-visible': 'Quiet',
    });
  });

  it('scores Kinwise and both door-only policies on the same situations', async () => {
    const { summary } = await runScenarios();
    // Kinwise: catches the scams it can connect to a call or reminder (it misses one: the 6-hour window had expired),
    // never alarms on a benign visitor, and tells the family only for a high-risk Pause.
    expect(summary.kinwise).toEqual({ scamsCaught: 2, scamsTotal: 3, falseUrgent: 0, benignTotal: 4, familyPings: 1 });
    // Door-only, urgent for every stranger: catches all three, but alarms on every harmless stranger
    // (the gardener and the aide are on the expected list, so any rule greets them calmly).
    expect(summary.doorOnlyUrgent).toEqual({ scamsCaught: 3, scamsTotal: 3, falseUrgent: 2, benignTotal: 4, familyPings: 5 });
    // Door-only, calm for every stranger: no false alarms, but catches nothing.
    expect(summary.doorOnlyCalm).toEqual({ scamsCaught: 0, scamsTotal: 3, falseUrgent: 0, benignTotal: 4, familyPings: 0 });
  });

  it('tells the family only when it matters (high risk), not for every stranger', async () => {
    const { rows } = await runScenarios();
    expect(rows.filter((r) => r.kinwiseFamilyPinged).map((r) => r.id)).toEqual(['scam-call-then-courier']);
  });

  it('keeps the published table in docs/evaluation.md in sync with the code', async () => {
    const generated = renderMarkdown(await runScenarios());
    const published = readFileSync(join(repoRoot, 'docs', 'evaluation.md'), 'utf8');
    expect(published.replace(/\r\n/g, '\n')).toBe(generated);
  });
});

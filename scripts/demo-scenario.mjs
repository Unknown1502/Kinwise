#!/usr/bin/env node
// Drive the hero story end to end against a running stack, for rehearsing the demo video:
//   node scripts/demo-scenario.mjs            # reset → reminder → "is this real?" → Asha presses Turn on on her TV → doorbell → (TV shows the Pause)
//   node scripts/demo-scenario.mjs --decline  # the same, but Asha says "Not now": the doorbell then gives only a gentle note
//   node scripts/demo-scenario.mjs --step 3   # run a single step
// Uses the hub's /sim/ask bridge (so the concierge + real MCP path is exercised) and the dev doorbell.
const HUB = (process.env.HUB_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const ASHA = process.env.RESIDENT_TOKEN ?? 'dev-asha';
const PRIYA = process.env.CAREGIVER_TOKEN ?? 'dev-priya';
const TV = process.env.TV_TOKEN ?? 'dev-tv';
const decline = process.argv.includes('--decline');
const only = process.argv.includes('--step') ? Number(process.argv[process.argv.indexOf('--step') + 1]) : null;
const sessionId = `scenario-${Date.now()}`;

async function post(path, body, token) {
  const res = await fetch(`${HUB}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function ask(token, text) {
  const out = await post('/sim/ask', { text, sessionId }, token);
  console.log(`   🗣  "${text}"`);
  console.log(`   🔊 ${out.reply}`);
  for (const c of out.toolCalls ?? []) {
    const level = c.result?.structuredContent?.level;
    console.log(`      ↳ ${c.name}${level ? ` (level: ${level})` : ''}${c.uiResourceUri ? `  [card ${c.uiResourceUri}]` : ''}`);
  }
  console.log(`      model ${out.model} · ${out.latencyMs} ms`);
}

const steps = [
  ['Reset the demo household', () => post('/dev/reset', {}, ASHA)],
  ['10:15 — Asha sets a reminder', () => ask(ASHA, 'Remind me at 2 PM: courier from the bank is picking up a package')],
  [
    '10:20 — Asha asks for a second opinion',
    () =>
      ask(
        ASHA,
        "A man from the FTC called. He said my accounts are compromised, I should withdraw my savings as gold, a courier will come, and I shouldn't tell my family. Is that real?",
      ),
  ],
  [
    decline
      ? '10:21 — Asha is asked about a six-hour safety watch and says "Not now"'
      : '10:21 — Asha says "turn it on" to Alexa: nothing starts, because Alexa cannot tell who is speaking',
    () => ask(ASHA, decline ? 'Not now' : 'Yes, turn it on'),
  ],
  ...(decline
    ? []
    : [
        [
          '10:22 — Asha presses Turn on on her TV (the only place that can start the watch)',
          async () => {
            // The TV names the question it is answering, exactly as its on-screen sheet does.
            const state = await (await fetch(`${HUB}/tv/state`, { headers: { authorization: `Bearer ${TV}` } })).json();
            const offerId = state.watch?.offer?.id;
            if (!offerId) throw new Error('No safety-watch question is open on the TV');
            console.log('   📺', JSON.stringify((await post('/tv/watch', { choice: 'turn_on', offerId }, TV)).message));
          },
        ],
      ]),
  [
    decline ? '14:41 — A stranger rings the doorbell (no watch was turned on, so the TV shows only a gentle note)' : '14:41 — A stranger rings the doorbell (the TV should show the Pause now)',
    async () => console.log('   🚪', JSON.stringify(await post('/dev/visitor', { description: 'A person at the front door holding a small box', carrying: 'a small box' }, ASHA))),
  ],
  ['Meera checks in', () => ask(PRIYA, "How's Mom's day going?")],
];

for (const [i, [title, fn]] of steps.entries()) {
  if (only && only !== i + 1) continue;
  console.log(`\n${i + 1}. ${title}`);
  await fn();
}
console.log('');

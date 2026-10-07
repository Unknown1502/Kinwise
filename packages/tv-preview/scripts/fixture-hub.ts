/**
 * A tiny stand-in hub that serves the TV app's test fixtures, for reviewing every screen in the
 * browser preview without a real hub or a staged scenario.
 *
 *   npx tsx scripts/fixture-hub.ts                       # http://localhost:8799
 *   open http://localhost:5174/?hub=http://localhost:8799&token=dev-tv
 *   curl -X POST localhost:8799/__fixture/pause          # switch the screen the TV sees
 *
 * Fixtures: home, empty, privacy, watching, pause, pause-no-message, gentle, expected,
 * onboarding, proposals.
 */
import {createServer} from 'node:http';
import type {TvStateView} from '../../tv-app/src/types';
import {SIGNS, expectedAlert, gentleAlert, homeState, notOnboarded, pauseAlert, withAlert} from '../../tv-app/test/fixtures';

const PORT = Number(process.env.PORT ?? 8799);

const home = homeState();
const fixtures: Record<string, () => TvStateView> = {
  home: () => home,
  empty: () => homeState({today: {...home.today, reminders: [], visits: [], messages: []}}),
  privacy: () =>
    homeState({
      today: {...home.today, privacyHourUntilLabel: '3:19 PM'},
      privacyHourUntil: '2026-10-05T19:19:11.527Z',
    }),
  watching: () => homeState({today: {...home.today, safety: {level: 'high', untilLabel: '8:18 PM', signs: SIGNS}}}),
  pause: () => withAlert(home, pauseAlert()),
  'pause-no-message': () => withAlert(home, pauseAlert({pauseMessage: undefined})),
  gentle: () => withAlert(home, gentleAlert()),
  expected: () => withAlert(home, expectedAlert()),
  onboarding: () => notOnboarded(home),
  proposals: () =>
    homeState({
      pendingProposals: [{id: 'visit_luis', label: 'Luis (gardener)', when: 'Thursdays 9:00 AM', proposedBy: 'Priya'}],
      today: {...home.today, safety: {level: 'elevated', untilLabel: '8:18 PM', signs: SIGNS.slice(0, 1)}},
    }),
};

let current = 'home';

const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (body: unknown, status = 200) =>
    res.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));

  if (url.pathname.startsWith('/__fixture/')) {
    const name = decodeURIComponent(url.pathname.slice('/__fixture/'.length));
    if (!fixtures[name]) return send({error: `unknown fixture ${name}`, known: Object.keys(fixtures)}, 404);
    current = name;
    return send({fixture: current});
  }
  if (url.pathname === '/tv/state') return send(fixtures[current]!());
  if (url.pathname === '/tv/privacy-hour') return send({untilLabel: '3:19 PM'});
  if (url.pathname.endsWith('/respond')) return send({alert: pauseAlert({status: 'resolved'}), message: 'Okay, I closed the alert.'});
  if (url.pathname.startsWith('/media/')) return send({error: 'no media in fixture mode'}, 404);
  return send({ok: true});
});

server.listen(PORT, () => console.log(`fixture hub on http://localhost:${PORT} (fixture: ${current})`));

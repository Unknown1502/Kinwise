import React from 'react';
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {StyleSheet} from 'react-native';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {HubClient} from '../../tv-app/src/api';
import {App} from '../../tv-app/src/App';
import {MIN_TEXT_SIZE, type as typeScale} from '../../tv-app/src/theme/theme';
import type {TvStateView} from '../../tv-app/src/types';
import {expectedAlert, gentleAlert, homeState, notOnboarded, pauseAlert, withAlert} from '../../tv-app/test/fixtures';

interface Post {
  path: string;
  body: Record<string, unknown>;
}

/** An in-memory stand-in for the hub's /tv API, reached through the real HubClient. */
function fakeHub(initial: TvStateView, opts: {callDelivered?: boolean} = {}) {
  let state = initial;
  const posts: Post[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    if ((init?.method ?? 'GET') === 'GET') return json(state);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    posts.push({path, body});
    if (path.endsWith('/respond')) {
      const alert = {...state.activeAlert!, status: 'resolved' as const, resolution: body.action as never};
      state = withAlert(state, undefined);
      const message =
        body.action === 'call_family'
          ? 'Calling Meera now.'
          : body.action === 'known_person'
            ? 'Okay. You can add them as an expected visitor so I remember next time.'
            : 'Okay, I closed the alert.';
      const delivered = body.action === 'call_family' ? (opts.callDelivered ?? true) : undefined;
      return json({alert, message, ...(delivered === undefined ? {} : {delivered})});
    }
    if (path === '/tv/consent') {
      const {onboarded, ...rest} = body;
      state = {
        ...state,
        consent: {...state.consent, ...(rest as object), ...(onboarded ? {onboardedAt: '2026-10-05T18:20:00.000Z'} : {})},
      };
      return json(state.consent);
    }
    if (path === '/tv/watch') {
      const turnOn = body.choice === 'turn_on';
      state = {...state, watch: {state: turnOn ? 'on' : 'declined', ...(turnOn ? {untilLabel: '8:19 PM'} : {})}};
      return json({message: turnOn ? 'The safety watch is on until 8:19 PM.' : "Okay, I won't turn it on.", watch: state.watch});
    }
    return json({ok: true});
  };

  return {
    client: new HubClient({baseUrl: 'http://hub.test:8787', token: 'dev-tv', fetchImpl}),
    posts,
    set(next: TvStateView) {
      state = next;
    },
  };
}

/** What the TV asked the hub to say aloud, in order. */
function spoken(posts: Post[]): string[] {
  return posts.filter((p) => p.path === '/speech').map((p) => String(p.body.text));
}

/** Everything else the TV sent (actions), without its speech requests. */
function actions(posts: Post[]): Post[] {
  return posts.filter((p) => p.path !== '/speech');
}

function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, {key});
  });
}

/** Spatial navigation places the initial focus just after a screen mounts; wait for `label` to have it. */
async function focusOn(label: string): Promise<void> {
  await vi.waitFor(() => expect(isFocused(label)).toBe(true));
}

function isFocused(label: string): boolean {
  return screen.getByTestId(`focusable:${label}`).getAttribute('aria-selected') === 'true';
}

function collectAnnouncements() {
  const said: string[] = [];
  const onAnnounce = (e: Event) => said.push(String((e as CustomEvent<string>).detail));
  window.addEventListener('kinwise:announce', onAnnounce);
  return {said, stop: () => window.removeEventListener('kinwise:announce', onAnnounce)};
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('theme', () => {
  it('never uses text smaller than 28 px', () => {
    for (const [name, style] of Object.entries(typeScale)) {
      const flat = StyleSheet.flatten(style) as {fontSize?: number};
      expect(flat.fontSize, name).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
    }
  });
});

describe('home screen', () => {
  it('renders the ambient board from TvStateView', async () => {
    const hub = fakeHub(homeState());
    render(<App client={hub.client} />);

    expect(await screen.findByTestId('home-screen')).toBeTruthy();
    // The hero is one accessible header; "PM" is set smaller in its own span.
    expect(screen.getByLabelText('2:19 PM. Good afternoon, Asha. Monday, October 5.')).toBeTruthy();
    expect(screen.getByText('Good afternoon, Asha')).toBeTruthy();
    expect(screen.getByText('Monday, October 5')).toBeTruthy();
    expect(screen.getByText('Kinwise is on')).toBeTruthy();
    expect(screen.getByText('Maria (home-health aide)')).toBeTruthy();
    expect(screen.getByText('Expected now')).toBeTruthy();
    expect(screen.getByText('Courier from the bank at 2 p.m.')).toBeTruthy();
    expect(screen.getAllByText('Kinwise checked this one')).toHaveLength(1);
    expect(screen.getByText('“Love you Mom! Call you tonight.”')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('Meera, 9:15 AM')).toBeTruthy();
    expect(screen.getByText('Privacy time for an hour')).toBeTruthy();
    expect(screen.getByText('Settings & privacy')).toBeTruthy();
  });

  it('labels every focusable element and starts on the first message', async () => {
    const hub = fakeHub(homeState());
    render(<App client={hub.client} />);
    await screen.findByTestId('home-screen');

    const focusables = document.querySelectorAll('[data-testid^="focusable:"]');
    expect(focusables.length).toBeGreaterThanOrEqual(4);
    focusables.forEach((el) => {
      expect(el.getAttribute('aria-label'), el.outerHTML.slice(0, 80)).toBeTruthy();
      expect(el.getAttribute('role'), el.getAttribute('aria-label') ?? '').toBeTruthy();
    });
    // Spatial navigation assigns the initial focus just after mount.
    await vi.waitFor(() => expect(isFocused('New message from Meera, 1:02 PM: Love you Mom! Call you tonight.')).toBe(true));
  });

  it('marks a message read when selected', async () => {
    const hub = fakeHub(homeState());
    render(<App client={hub.client} />);
    await screen.findByTestId('home-screen');
    // Spatial navigation assigns the initial focus just after mount; pressing Enter before
    // anything is focused is a no-op, which made this test flaky on fresh installs.
    await vi.waitFor(() => expect(document.querySelector('[aria-selected="true"]')).not.toBeNull());
    press('Enter');
    await vi.waitFor(() => expect(hub.posts).toContainEqual({path: '/tv/messages/msg_1/read', body: {}}));
  });

  it('shows the safety watch status', async () => {
    const s = homeState();
    const hub = fakeHub({...s, today: {...s.today, safety: {level: 'high', untilLabel: '8:18 PM', signs: []}}});
    render(<App client={hub.client} />);
    expect(await screen.findByText('Watching the door closely')).toBeTruthy();
    expect(screen.getByText("Until 8:18 PM, after today's warning signs")).toBeTruthy();
  });

  it('shows how much privacy time is left, measured on the hub clock', async () => {
    const s = homeState();
    // serverTime is 18:19:11Z; privacy time ends 45 minutes later.
    const hub = fakeHub({...s, privacyHourUntil: '2026-10-05T19:04:11.527Z', today: {...s.today, privacyHourUntilLabel: '3:04 PM'}});
    render(<App client={hub.client} />);
    expect(await screen.findByText('Privacy time')).toBeTruthy();
    expect(screen.getByText('45 minutes left, until 3:04 PM')).toBeTruthy();
    expect(screen.getByText('End privacy time')).toBeTruthy();
  });

  it('opens Settings & privacy and returns with Back', async () => {
    const s = homeState();
    const hub = fakeHub({
      ...s,
      today: {...s.today, messages: [], safety: {level: 'high', untilLabel: '8:18 PM', signs: []}},
      pendingProposals: [{id: 'visit_9', label: 'Sam (plumber)', when: 'Oct 7 9:00 AM–10:00 AM', proposedBy: 'Meera'}],
    });
    render(<App client={hub.client} />);
    await screen.findByTestId('home-screen');
    await focusOn('Settings & privacy');
    press('Enter');
    expect(await screen.findByTestId('settings-screen')).toBeTruthy();
    expect(screen.getByText('What Kinwise may notice')).toBeTruthy();
    expect(screen.getByText('Sam (plumber), Oct 7 9:00 AM–10:00 AM')).toBeTruthy();
    expect(screen.getByText('Meera viewed today\'s overview')).toBeTruthy();
    expect(screen.getByText('End safety watch')).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(5);  // four consent switches + Read things aloud
    press('Escape');
    expect(await screen.findByTestId('home-screen')).toBeTruthy();
  });
});

describe('the safety-watch question', () => {
  const asked = (): TvStateView => ({
    ...homeState(),
    today: {...homeState().today, messages: []}, // no unread message, so focus starts on the buttons
    watch: {state: 'offered', offer: {id: 'offer_1', hours: 6, expiresAt: '2026-10-05T18:49:00.000Z', notifies: 'Meera'}},
  });

  it('puts the question on Home as a sheet, says what is and is not shared, and starts nothing by itself', async () => {
    const hub = fakeHub(asked());
    render(<App client={hub.client} />);
    expect(await screen.findByTestId('watch-offer-overlay')).toBeTruthy();
    expect(screen.getAllByText('Kinwise has a question').length).toBeGreaterThan(0);
    expect(screen.getByText(/6-hour safety watch for your front door, and tell Meera if it looks serious/)).toBeTruthy();
    expect(screen.getByText(/Nothing is turned on, and nobody is told, unless you choose Turn on/)).toBeTruthy();
    expect(actions(hub.posts)).toEqual([]);
  });

  it('focuses "Not now", so an accidental OK press starts nothing', async () => {
    render(<App client={fakeHub(asked()).client} />);
    await screen.findByTestId('watch-offer-overlay');
    await focusOn('Not now');
    expect(isFocused('Turn on a 6 hour safety watch')).toBe(false);
  });

  it('"Turn on" and "Not now" send exactly her choice for that question', async () => {
    for (const [label, choice] of [['Turn on a 6 hour safety watch', 'turn_on'], ['Not now', 'not_now']] as const) {
      const hub = fakeHub(asked());
      render(<App client={hub.client} />);
      await screen.findByTestId('watch-offer-overlay');
      fireEvent.click(screen.getByTestId(`focusable:${label}`));
      await vi.waitFor(() => expect(actions(hub.posts)).toContainEqual({path: '/tv/watch', body: {choice, offerId: 'offer_1'}}));
      cleanup();
    }
  });

  it('Back only tucks the sheet away: nothing is answered, and the question waits in Settings & privacy', async () => {
    const hub = fakeHub(asked());
    render(<App client={hub.client} />);
    await screen.findByTestId('watch-offer-overlay');
    press('Escape');
    await vi.waitFor(() => expect(screen.queryByTestId('watch-offer-overlay')).toBeNull());
    expect(actions(hub.posts)).toEqual([]);
    expect(screen.getByText('Open Settings & privacy to answer. Nothing is on yet')).toBeTruthy();

    await focusOn('Settings & privacy');
    press('Enter');
    await screen.findByTestId('settings-screen');
    expect(screen.getByText('Turn on a safety watch?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('focusable:Turn on a 6 hour safety watch'));
    await vi.waitFor(() => expect(actions(hub.posts)).toContainEqual({path: '/tv/watch', body: {choice: 'turn_on', offerId: 'offer_1'}}));
  });

  it('never covers a Pause or a visitor panel: those come first', async () => {
    const hub = fakeHub({...withAlert(asked(), pauseAlert())});
    render(<App client={hub.client} />);
    expect(await screen.findByTestId('pause-screen')).toBeTruthy();
    expect(screen.queryByTestId('watch-offer-overlay')).toBeNull();
  });
});

describe('the Pause', () => {
  it('takes over the screen, announces itself and focuses "Call Meera"', async () => {
    const said = collectAnnouncements();
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);

    const pause = await screen.findByTestId('pause-screen');
    expect(within(pause).getByText('Pause before you open the door')).toBeTruthy();
    expect(
      within(pause).getByText('No visit is expected right now. Earlier today, Kinwise noticed 3 courier-scam warning signs.'),
    ).toBeTruthy();
    expect(within(pause).getByText('Bank or agency')).toBeTruthy();
    expect(within(pause).getByText('Someone coming to collect')).toBeTruthy();
    expect(within(pause).getByText('A message from Meera')).toBeTruthy();
    expect(within(pause).getByText(/Real banks and agencies never send couriers/)).toBeTruthy();
    expect(screen.queryByTestId('home-screen')).toBeNull();
    await focusOn('Call Meera');
    expect(said.said.some((t) => t.startsWith('Pause before you open the door.'))).toBe(true);
    said.stop();
  });

  it('shows the focused sign explanation', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    expect(screen.getByText(/Real agencies never ask you to move money/)).toBeTruthy();
    await focusOn('Call Meera');
    press('ArrowUp');
    press('ArrowRight');
    expect(isFocused('Warning sign: Pressure to act now')).toBe(true);
    expect(screen.getByText(/Pressure to act fast is the most common scam warning sign/)).toBeTruthy();
  });

  it('Call Meera → responds call_family and says Meera is being told', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    await focusOn('Call Meera');
    press('Enter');
    expect(await screen.findByText('Telling Meera now…')).toBeTruthy();
    expect(hub.posts).toContainEqual({path: '/tv/alerts/alert_pause_1/respond', body: {action: 'call_family'}});
  });

  it('returns home after the confirmation with a working D-pad focus', async () => {
    const s = homeState();
    const calm = {...s, today: {...s.today, messages: []}};
    const hub = fakeHub(calm);
    render(<App client={hub.client} />);
    await screen.findByTestId('home-screen');
    hub.set(withAlert(calm, pauseAlert()));
    await screen.findByTestId('pause-screen', undefined, {timeout: 4000});
    await focusOn('Call Meera');
    press('Enter');
    await screen.findByText('Telling Meera now…');
    expect(await screen.findByTestId('home-screen', undefined, {timeout: 8000})).toBeTruthy();
    await focusOn('Settings & privacy');
    press('Enter');
    expect(await screen.findByTestId('settings-screen')).toBeTruthy();
  }, 15000);

  it('"I know this person" is one press to the right', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    await focusOn('Call Meera');
    press('ArrowRight');
    expect(isFocused('I know this person')).toBe(true);
    press('Enter');
    await vi.waitFor(() =>
      expect(hub.posts).toContainEqual({path: '/tv/alerts/alert_pause_1/respond', body: {action: 'known_person'}}),
    );
    expect(await screen.findByTestId('home-screen')).toBeTruthy();
  });

  it('Back does not close the Pause', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    press('Escape');
    expect(screen.getByTestId('pause-screen')).toBeTruthy();
    // The only thing the TV sends on its own is the report that the Pause is on screen; Back closes nothing.
    expect(actions(hub.posts).filter((p) => !p.path.endsWith('/shown'))).toHaveLength(0);
  });

  it('tells the hub once that the Pause is on screen (the hub otherwise only knows it was sent)', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    await vi.waitFor(() => expect(actions(hub.posts).map((p) => p.path)).toEqual(['/tv/alerts/alert_pause_1/shown']));
    await new Promise((r) => setTimeout(r, 2500)); // a few polls later it is not repeated
    expect(actions(hub.posts).filter((p) => p.path.endsWith('/shown'))).toHaveLength(1);
  });

  it('retries the "shown" report when a request fails, so one dropped request does not leave a seen Pause unconfirmed', async () => {
    const posts: string[] = [];
    const hub = new HubClient({
      baseUrl: 'http://hub.test:8787',
      token: 'dev-tv',
      fetchImpl: async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify(withAlert(homeState(), pauseAlert())), {status: 200, headers: {'content-type': 'application/json'}});
        if (path.endsWith('/shown')) {
          posts.push(path);
          if (posts.length === 1) return new Response('{"error":"boom"}', {status: 503, headers: {'content-type': 'application/json'}});
        }
        return new Response('{"ok":true}', {status: 200, headers: {'content-type': 'application/json'}});
      },
    });
    render(<App client={hub} />);
    await screen.findByTestId('pause-screen');
    await vi.waitFor(() => expect(posts.length).toBe(2), {timeout: 6000});
    await new Promise((r) => setTimeout(r, 2500));
    expect(posts.length).toBe(2); // one failure, one success, then it stops
  });

  it('does not report a Pause the hub already has as shown', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert({delivery: 'shown'})));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    await new Promise((r) => setTimeout(r, 300));
    expect(actions(hub.posts)).toHaveLength(0);
  });
});

describe('overlays', () => {
  it('shows the gentle panel over Home with its own focus', async () => {
    const hub = fakeHub(withAlert(homeState(), gentleAlert()));
    render(<App client={hub.client} />);
    const overlay = await screen.findByTestId('gentle-overlay');
    expect(within(overlay).getByText("A visitor isn't on today's list")).toBeTruthy();
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    await focusOn('I know this person');
    // Home's root is inactive under the overlay: exactly one element looks focused.
    expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    press('ArrowRight');
    press('Enter');
    await vi.waitFor(() =>
      expect(hub.posts).toContainEqual({path: '/tv/alerts/alert_gentle_1/respond', body: {action: 'dismiss'}}),
    );
    await vi.waitFor(() => expect(screen.queryByTestId('gentle-overlay')).toBeNull());
  });

  it('shows the expected toast and hides it after 8 s', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    const hub = fakeHub(withAlert(homeState(), expectedAlert()));
    render(<App client={hub.client} />);
    expect(await screen.findByText('Luis (gardener) is at the door')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });
    expect(screen.queryByText('Luis (gardener) is at the door')).toBeNull();
    // The notice is also cleared quietly on the hub (no timeline entry, no family alert).
    expect(actions(hub.posts)).toEqual([{path: '/tv/alerts/alert_expected_1/seen', body: {}}]);
    expect(spoken(hub.posts)).toEqual(["Luis (gardener) is at the door. They're on today's list."]);
  });
});

describe('the TV talks', () => {
  it('says the Pause aloud as it appears', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    await vi.waitFor(() =>
      expect(spoken(hub.posts)).toEqual([
        'Asha, someone is at your door, and no visit is expected right now. Please pause before you open it. Press OK to call Meera.',
      ]),
    );
  });

  it("says so, aloud and on screen, when Meera could not be reached, and stays long enough to read", async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()), {callDelivered: false});
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    await focusOn('Call Meera');
    press('Enter');
    expect(await screen.findByText("We couldn't reach Meera")).toBeTruthy();
    expect(screen.getByText(/Please call Meera on your phone/)).toBeTruthy();
    await vi.waitFor(() =>
      expect(spoken(hub.posts)).toContain("I couldn't reach Meera. Please call Meera yourself. You don't need to open the door."),
    );
    await new Promise((r) => setTimeout(r, 7000)); // well past the 6 s success confirmation
    expect(screen.queryByTestId('home-screen')).toBeNull();
    press('Escape');
    expect(await screen.findByTestId('home-screen')).toBeTruthy();
  }, 20000);

  it('confirms the call aloud', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    await focusOn('Call Meera');
    press('Enter');
    await screen.findByText('Telling Meera now…');
    await vi.waitFor(() => expect(spoken(hub.posts)).toContain("I've told Meera to call you. You don't need to open the door."));
  });

  it('reads aloud what Alexa sends to the TV, and new messages', async () => {
    const s = homeState();
    const hub = fakeHub(s);
    render(<App client={hub.client} />);
    await screen.findByTestId('home-screen');
    hub.set({
      ...s,
      cue: {id: 'cue_1', topic: 'messages', text: 'You have one message. Meera, at 1:02 PM: Love you Mom!'},
      today: {...s.today, messages: [{id: 'msg_new', from: 'Meera', text: 'On my way.', timeLabel: '2:20 PM', unread: true}, ...s.today.messages]},
    });
    expect(await screen.findByText('Reading your messages aloud.', undefined, {timeout: 4000})).toBeTruthy();
    await vi.waitFor(() =>
      expect(spoken(hub.posts)).toEqual(['New message from Meera: On my way.', 'You have one message. Meera, at 1:02 PM: Love you Mom!']),
    );
  });

  it('can be switched off in Settings', async () => {
    const s = homeState();
    const hub = fakeHub({...s, today: {...s.today, messages: []}});
    render(<App client={hub.client} />);
    await screen.findByTestId('home-screen');
    await focusOn('Settings & privacy');
    press('Enter');
    await screen.findByTestId('settings-screen');
    expect(screen.getByText('Read things aloud')).toBeTruthy();
    const voiceSwitch = screen.getByTestId('focusable:Read things aloud');
    expect(voiceSwitch.getAttribute('aria-checked')).toBe('true');
  });
});

describe('onboarding', () => {
  it('walks three steps and saves consent with onboarded: true', async () => {
    const hub = fakeHub(notOnboarded(homeState()));
    render(<App client={hub.client} />);
    expect(await screen.findByText('Kinwise is your second opinion')).toBeTruthy();
    await focusOn('Get started');
    press('Enter'); // Get started

    expect(await screen.findByText('Choose what Kinwise may notice')).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    await focusOn('Check for scam warning signs');
    press('Enter'); // turn scam screening off
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown'); // buttons row
    press('ArrowRight'); // Next
    press('Enter');

    expect(await screen.findByText('Meera sees signals, never recordings')).toBeTruthy();
    await focusOn('Finish');
    press('Enter');
    await vi.waitFor(() =>
      expect(hub.posts).toContainEqual({
        path: '/tv/consent',
        body: {
          scamScreening: false,
          doorAwareness: true,
          caregiverAlerts: true,
          shareTimelineWithCaregiver: true,
          onboarded: true,
        },
      }),
    );
    expect(await screen.findByTestId('home-screen')).toBeTruthy();
  });
});

describe('connection', () => {
  it('explains when the hub cannot be reached', async () => {
    const client = new HubClient({
      baseUrl: 'http://nowhere.test',
      token: 'dev-tv',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    render(<App client={client} />);
    expect(await screen.findByText('Still trying to reach Kinwise…')).toBeTruthy();
    expect(screen.getByText('Hub address: http://nowhere.test')).toBeTruthy();
  });
});

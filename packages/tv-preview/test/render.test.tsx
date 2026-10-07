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
function fakeHub(initial: TvStateView) {
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
          ? 'Calling Priya now.'
          : body.action === 'known_person'
            ? 'Okay. You can add them as an expected visitor so I remember next time.'
            : 'Okay, I closed the alert.';
      return json({alert, message});
    }
    if (path === '/tv/consent') {
      const {onboarded, ...rest} = body;
      state = {
        ...state,
        consent: {...state.consent, ...(rest as object), ...(onboarded ? {onboardedAt: '2026-10-05T18:20:00.000Z'} : {})},
      };
      return json(state.consent);
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

function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, {key});
  });
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

describe('Today at Home', () => {
  it('renders the ambient board from TvStateView', async () => {
    const hub = fakeHub(homeState());
    render(<App client={hub.client} />);

    expect(await screen.findByText('Today at Home')).toBeTruthy();
    expect(screen.getByText('2:19 PM')).toBeTruthy();
    expect(screen.getByText('Monday, October 5')).toBeTruthy();
    expect(screen.getByText('Kinwise is on')).toBeTruthy();
    expect(screen.getByText('Maria (home-health aide)')).toBeTruthy();
    expect(screen.getByText('Courier from the bank at 2 p.m.')).toBeTruthy();
    expect(screen.getAllByText('checked')).toHaveLength(1);
    expect(screen.getByText('Love you Mom! Call you tonight.')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('Privacy time · 1 hour')).toBeTruthy();
    expect(screen.getByText('Settings & privacy')).toBeTruthy();
  });

  it('labels every focusable element and starts on the first message', async () => {
    const hub = fakeHub(homeState());
    render(<App client={hub.client} />);
    await screen.findByText('Today at Home');

    const focusables = document.querySelectorAll('[data-testid^="focusable:"]');
    expect(focusables.length).toBeGreaterThanOrEqual(4);
    focusables.forEach((el) => {
      expect(el.getAttribute('aria-label'), el.outerHTML.slice(0, 80)).toBeTruthy();
      expect(el.getAttribute('role'), el.getAttribute('aria-label') ?? '').toBeTruthy();
    });
    expect(isFocused('New message from Priya, 1:02 PM: Love you Mom! Call you tonight.')).toBe(true);
  });

  it('marks a message read when selected', async () => {
    const hub = fakeHub(homeState());
    render(<App client={hub.client} />);
    await screen.findByText('Today at Home');
    // Spatial navigation assigns the initial focus just after mount; pressing Enter before
    // anything is focused is a no-op, which made this test flaky on fresh installs.
    await vi.waitFor(() => expect(document.querySelector('[aria-selected="true"]')).not.toBeNull());
    press('Enter');
    await vi.waitFor(() => expect(hub.posts).toContainEqual({path: '/tv/messages/msg_1/read', body: {}}));
  });

  it('shows the amber safety watch pill', async () => {
    const s = homeState();
    const hub = fakeHub({...s, today: {...s.today, safety: {level: 'high', untilLabel: '8:18 PM', signs: []}}});
    render(<App client={hub.client} />);
    expect(await screen.findByText('Watching the door until 8:18 PM')).toBeTruthy();
  });

  it('opens Settings & privacy and returns with Back', async () => {
    const s = homeState();
    const hub = fakeHub({
      ...s,
      today: {...s.today, messages: [], safety: {level: 'high', untilLabel: '8:18 PM', signs: []}},
      pendingProposals: [{id: 'visit_9', label: 'Sam (plumber)', when: 'Oct 7 9:00 AM–10:00 AM', proposedBy: 'Priya'}],
    });
    render(<App client={hub.client} />);
    await screen.findByText('Today at Home');
    expect(isFocused('Settings & privacy')).toBe(true);
    press('Enter');
    expect(await screen.findByTestId('settings-screen')).toBeTruthy();
    expect(screen.getByText('What Kinwise may notice')).toBeTruthy();
    expect(screen.getByText('Sam (plumber) · Oct 7 9:00 AM–10:00 AM')).toBeTruthy();
    expect(screen.getByText('Priya viewed today\'s overview')).toBeTruthy();
    expect(screen.getByText('End safety watch')).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    press('Escape');
    expect(await screen.findByText('Today at Home')).toBeTruthy();
  });
});

describe('the Pause', () => {
  it('takes over the screen, announces itself and focuses "Call Priya"', async () => {
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
    expect(within(pause).getByText('A message from Priya')).toBeTruthy();
    expect(within(pause).getByText(/Real banks and agencies never send couriers/)).toBeTruthy();
    expect(screen.queryByText('Today at Home')).toBeNull();
    expect(isFocused('Call Priya')).toBe(true);
    expect(said.said.some((t) => t.startsWith('Pause before you open the door.'))).toBe(true);
    said.stop();
  });

  it('shows the focused sign explanation', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    expect(screen.getByText(/Real agencies never ask you to move money/)).toBeTruthy();
    press('ArrowUp');
    press('ArrowRight');
    expect(isFocused('Warning sign: Pressure to act now')).toBe(true);
    expect(screen.getByText(/Pressure to act fast is the most common scam warning sign/)).toBeTruthy();
  });

  it('Call Priya → responds call_family and confirms "Calling Priya now…"', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    press('Enter');
    expect(await screen.findByText('Calling Priya now…')).toBeTruthy();
    expect(hub.posts).toContainEqual({path: '/tv/alerts/alert_pause_1/respond', body: {action: 'call_family'}});
  });

  it('returns home after the 5 s confirmation with a working D-pad focus', async () => {
    const s = homeState();
    const calm = {...s, today: {...s.today, messages: []}};
    const hub = fakeHub(calm);
    render(<App client={hub.client} />);
    await screen.findByText('Today at Home');
    hub.set(withAlert(calm, pauseAlert()));
    await screen.findByTestId('pause-screen', undefined, {timeout: 4000});
    press('Enter');
    await screen.findByText('Calling Priya now…');
    expect(await screen.findByText('Today at Home', undefined, {timeout: 7000})).toBeTruthy();
    expect(isFocused('Settings & privacy')).toBe(true);
    press('Enter');
    expect(await screen.findByTestId('settings-screen')).toBeTruthy();
  }, 15000);

  it('"I know this person" is one press to the right', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    press('ArrowRight');
    expect(isFocused('I know this person')).toBe(true);
    press('Enter');
    await vi.waitFor(() =>
      expect(hub.posts).toContainEqual({path: '/tv/alerts/alert_pause_1/respond', body: {action: 'known_person'}}),
    );
    expect(await screen.findByText('Today at Home')).toBeTruthy();
  });

  it('Back does not close the Pause', async () => {
    const hub = fakeHub(withAlert(homeState(), pauseAlert()));
    render(<App client={hub.client} />);
    await screen.findByTestId('pause-screen');
    press('Escape');
    expect(screen.getByTestId('pause-screen')).toBeTruthy();
    expect(hub.posts).toHaveLength(0);
  });
});

describe('overlays', () => {
  it('shows the gentle panel over Home with its own focus', async () => {
    const hub = fakeHub(withAlert(homeState(), gentleAlert()));
    render(<App client={hub.client} />);
    const overlay = await screen.findByTestId('gentle-overlay');
    expect(within(overlay).getByText("A visitor isn't on today's list")).toBeTruthy();
    expect(screen.getByText('Today at Home')).toBeTruthy();
    expect(isFocused('I know this person')).toBe(true);
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
    expect(await screen.findByText('Luis (gardener) is here — expected')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });
    expect(screen.queryByText('Luis (gardener) is here — expected')).toBeNull();
    // The notice is also cleared quietly on the hub (no timeline entry, no family alert).
    expect(hub.posts).toEqual([{path: '/tv/alerts/alert_expected_1/seen', body: {}}]);
  });
});

describe('onboarding', () => {
  it('walks three steps and saves consent with onboarded: true', async () => {
    const hub = fakeHub(notOnboarded(homeState()));
    render(<App client={hub.client} />);
    expect(await screen.findByText('Kinwise is your second opinion')).toBeTruthy();
    press('Enter'); // Get started

    expect(await screen.findByText('Choose what Kinwise may notice')).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(isFocused('Check for scam warning signs')).toBe(true);
    press('Enter'); // turn scam screening off
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown'); // buttons row
    press('ArrowRight'); // Next
    press('Enter');

    expect(await screen.findByText('Priya sees signals, never recordings')).toBeTruthy();
    expect(isFocused('Finish')).toBe(true);
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
    expect(await screen.findByText('Today at Home')).toBeTruthy();
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

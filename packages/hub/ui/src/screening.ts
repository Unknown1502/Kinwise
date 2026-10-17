import { LEVEL_TEXT, brand, callAndRender, el, mountCard, signsList, type CardContext, type Sign } from './shared.js';

interface WatchData {
  state: 'none' | 'offered' | 'on' | 'declined';
  untilLabel?: string;
  offer?: { id: string; hours: number; notifies?: string };
}

interface ScreeningData {
  /** Absent when this is the answer to the safety-watch question (message / privacy) rather than a screening. */
  mode?: 'reminder' | 'check';
  watch?: WatchData;
  message?: string;
  privacy?: string[];
  level: 'none' | 'elevated' | 'high';
  signs: Sign[];
  advice: string[];
  followUp?: string;
  riskWindow: { level: 'none' | 'elevated' | 'high'; untilLabel?: string };
  caregiverName: string;
  reminder?: { text: string; timeLabel: string };
}

/** "Would you like a six-hour safety watch?": three plain choices, nothing happens until she picks one. */
function watchQuestion(d: ScreeningData, ctx: CardContext): HTMLElement {
  const offer = d.watch!.offer!;
  const tell = offer.notifies ? ` and tell ${offer.notifies} if it looks serious` : '';
  const turnOn = el('button', { class: 'primary' }, 'Turn on') as HTMLButtonElement;
  const notNow = el('button', {}, 'Not now') as HTMLButtonElement;
  const review = el('button', {}, 'Review privacy') as HTMLButtonElement;
  const answer = (b: HTMLButtonElement, choice: string) => () => callAndRender(ctx, b, 'kinwise_set_safety_watch', { offerId: offer.id, choice });
  turnOn.addEventListener('click', answer(turnOn, 'turn_on'));
  notNow.addEventListener('click', answer(notNow, 'not_now'));
  review.addEventListener('click', answer(review, 'review_privacy'));
  const box = el(
    'section',
    { class: 'note', 'aria-label': 'Safety watch question' },
    el('h2', {}, 'Turn on a safety watch?'),
    el('p', { class: 'big' }, `Would you like a ${offer.hours}-hour safety watch for your front door${tell}?`),
    el('p', {}, "Nothing is turned on, and nobody is told, unless you choose Turn on."),
    el('div', { class: 'actions' }, turnOn, notNow, review),
  );
  queueMicrotask(() => turnOn.focus());
  return box;
}

mountCard('second opinion', (d: ScreeningData, ctx: CardContext) => {
  if (!d.mode) {
    // The answer to the question: what happened, and (for "review privacy") what the watch shares.
    const card = el('div', { class: 'card', role: 'region', 'aria-label': 'Kinwise safety watch' }, brand('safety watch'));
    card.append(el('p', { class: 'big', role: 'status' }, d.message ?? ''));
    if (d.privacy?.length) card.append(el('ul', { class: 'advice' }, ...d.privacy.map((a) => el('li', {}, a))));
    if (d.watch?.state === 'offered' && d.watch.offer) card.append(watchQuestion(d, ctx));
    return card;
  }
  const lvl = LEVEL_TEXT[d.level] ?? LEVEL_TEXT.none;
  const card = el('div', { class: 'card', role: 'region', 'aria-label': 'Kinwise second opinion' }, brand(d.mode === 'reminder' ? 'reminder' : 'second opinion'));

  if (d.reminder) {
    card.append(el('h1', {}, `Reminder at ${d.reminder.timeLabel}`), el('p', { class: 'big' }, d.reminder.text));
  }

  if (d.mode === 'check' || d.level !== 'none') {
    card.append(
      el(
        'div',
        { class: `banner ${d.level}`, role: 'status' },
        el('span', { class: 'icon', 'aria-hidden': 'true' }, lvl.icon),
        el('div', {}, el('strong', { class: 'big' }, lvl.title), d.followUp ? el('p', {}, d.followUp) : null),
      ),
    );
  }

  if (d.signs.length) card.append(el('h2', {}, 'What Kinwise noticed'), signsList(d.signs));
  if (d.advice.length) card.append(el('h2', {}, 'What to do'), el('ul', { class: 'advice' }, ...d.advice.map((a) => el('li', {}, a))));

  if (d.watch?.state === 'offered' && d.watch.offer) card.append(watchQuestion(d, ctx));
  if (d.watch?.state === 'declined') card.append(el('p', { class: 'note' }, "You chose not now, so the safety watch is off and nobody was told. I won't ask again for an hour."));
  if (d.riskWindow.level !== 'none') {
    card.append(
      el('p', { class: 'note' }, `Kinwise is watching the front door more closely until ${d.riskWindow.untilLabel}. If someone you don't expect arrives, your TV will pause and offer to call ${d.caregiverName}.`),
    );
  }
  if (d.mode === 'check') card.append(el('p', { class: 'note' }, 'The words of this call were not saved. Only the warning signs were noted.'));
  return card;
});

import { LEVEL_TEXT, brand, el, mountCard, signsList, type Sign } from './shared.js';

interface ScreeningData {
  mode: 'reminder' | 'check';
  level: 'none' | 'elevated' | 'high';
  signs: Sign[];
  advice: string[];
  followUp?: string;
  riskWindow: { level: 'none' | 'elevated' | 'high'; untilLabel?: string };
  caregiverName: string;
  reminder?: { text: string; timeLabel: string };
}

mountCard('second opinion', (d: ScreeningData) => {
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

  if (d.riskWindow.level !== 'none') {
    card.append(
      el('p', { class: 'note' }, `Kinwise is watching the front door more closely until ${d.riskWindow.untilLabel}. If someone you don't expect arrives, your TV will pause and offer to call ${d.caregiverName}.`),
    );
  }
  if (d.mode === 'check') card.append(el('p', { class: 'note' }, 'The words of this call were not saved. Only the warning signs were noted.'));
  return card;
});

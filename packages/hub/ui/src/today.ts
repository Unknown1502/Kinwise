import { LEVEL_TEXT, brand, el, mountCard } from './shared.js';

interface TodayData {
  residentName: string;
  caregiverName: string;
  dateLabel: string;
  timeLabel: string;
  reminders?: Array<{ text: string; timeLabel: string; flagged: boolean }>;
  visits: Array<{ label: string; timeLabel: string }>;
  messages: Array<{ from: string; text: string; timeLabel: string; unread: boolean }>;
  safety: { level: 'none' | 'elevated' | 'high'; untilLabel?: string };
  activeAlert?: { kind: string; description: string; visitLabel?: string; createdLabel: string };
  privacyHourUntilLabel?: string;
}

const rows = (items: Array<[string, string, boolean?]>, empty: string) =>
  items.length
    ? el('ul', { class: 'rows' }, ...items.map(([left, right, flag]) => el('li', {}, el('span', {}, left, flag ? el('span', { class: 'flag' }, '  · checked') : null), el('span', { class: 'time' }, right))))
    : el('p', { class: 'empty' }, empty);

mountCard('today', (d: TodayData) => {
  const card = el('div', { class: 'card' }, brand('today at home'), el('h1', {}, d.dateLabel), el('p', { class: 'muted' }, `Now ${d.timeLabel}`));

  if (d.privacyHourUntilLabel) {
    card.append(el('div', { class: 'banner' }, el('span', { class: 'icon' }, '🌙'), el('div', {}, el('strong', {}, `Privacy time until ${d.privacyHourUntilLabel}`), el('p', {}, 'Kinwise is not noticing the door.'))));
  } else if (d.safety.level !== 'none') {
    card.append(
      el('div', { class: `banner ${d.safety.level}` }, el('span', { class: 'icon' }, LEVEL_TEXT[d.safety.level].icon), el('div', {}, el('strong', {}, `Watching the door until ${d.safety.untilLabel}`), el('p', {}, 'Because of warning signs earlier today.'))),
    );
  }

  if (d.activeAlert) {
    const what = d.activeAlert.kind === 'expected' ? `${d.activeAlert.visitLabel} is here` : d.activeAlert.description;
    card.append(el('h2', {}, `At the door · ${d.activeAlert.createdLabel}`), el('p', { class: 'big' }, what));
  }

  card.append(el('h2', {}, 'Expected visitors'), rows(d.visits.map((v) => [v.label, v.timeLabel]), 'Nobody is expected today.'));
  if (d.reminders) card.append(el('h2', {}, 'Reminders'), rows(d.reminders.map((r) => [r.text, r.timeLabel, r.flagged]), 'No reminders today.'));
  card.append(el('h2', {}, 'From family'), rows(d.messages.map((m) => [`${m.from}: ${m.text}`, m.timeLabel]), 'No new messages.'));
  return card;
});

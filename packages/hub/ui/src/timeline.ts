import { brand, el, mountCard } from './shared.js';

interface TimelineData {
  dateLabel: string;
  residentName: string;
  entries: Array<{ timeLabel: string; kind: string; text: string }>;
  summary: { pausesShown: number; unexpectedVisitors: number; expectedVisitors: number; flaggedCalls: number };
}

const stat = (n: number, label: string) => el('div', { class: 'stat' }, el('b', {}, String(n)), label);

mountCard('timeline', (d: TimelineData) => {
  const card = el(
    'div',
    { class: 'card' },
    brand('family view'),
    el('h1', {}, `${d.residentName}'s day`),
    el('p', { class: 'muted' }, d.dateLabel),
    el(
      'div',
      { class: 'summary' },
      stat(d.summary.expectedVisitors, 'expected visitors'),
      stat(d.summary.unexpectedVisitors, 'unexpected'),
      stat(d.summary.pausesShown, 'Pauses shown'),
      stat(d.summary.flaggedCalls, 'calls checked'),
    ),
  );
  card.append(
    d.entries.length
      ? el('ol', { class: 'timeline' }, ...d.entries.map((e) => el('li', { class: e.kind }, el('span', { class: 'muted' }, e.timeLabel), ' ', e.text)))
      : el('p', { class: 'empty' }, 'A quiet day so far.'),
    el('p', { class: 'note' }, `Signals only. You never see recordings, transcripts or ${d.residentName}'s reminders. ${d.residentName} can see that you looked.`),
  );
  return card;
});

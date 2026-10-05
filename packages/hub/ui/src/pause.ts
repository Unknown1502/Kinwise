import { brand, callAndRender, el, mountCard, signsList, type CardContext, type Sign } from './shared.js';

interface AlertData {
  id: string;
  kind: 'pause' | 'gentle' | 'expected';
  status: 'active' | 'resolved' | 'expired';
  createdLabel: string;
  description: string;
  visitLabel?: string;
  riskLevel?: 'elevated' | 'high';
  signs: Sign[];
  caregiverName: string;
  pauseMessage?: { from: string; text: string };
  resolution?: 'call_family' | 'known_person' | 'dismiss';
  resolvedLabel?: string;
}

/** Accepts kinwise_respond_to_alert ({alert, message}) and kinwise_explain_last_alert ({alert?, summary}). */
interface Payload {
  alert?: AlertData;
  message?: string;
  summary?: string;
}

function render(p: Payload, ctx: CardContext): Node {
  const a = p.alert;
  const card = el('div', { class: 'card', role: 'region', 'aria-label': 'Kinwise door alert' }, brand('the pause'));
  if (!a) {
    card.append(el('h1', {}, 'All calm'), el('p', {}, p.summary ?? 'There have been no alerts recently.'));
    return card;
  }

  const title =
    a.kind === 'pause'
      ? 'Pause before you open the door'
      : a.kind === 'gentle'
        ? "A visitor isn't on today's list"
        : `${a.visitLabel} is here`;
  card.append(el('h1', {}, title), el('p', { class: 'muted' }, `${a.createdLabel} · ${a.description}`));

  if (a.kind === 'pause') {
    card.append(
      el(
        'div',
        { class: 'banner pause' },
        el('span', { class: 'icon', 'aria-hidden': 'true' }, '⏸'),
        el('div', {}, el('strong', {}, 'No visit is expected right now.'), el('p', {}, `Earlier today, Kinwise noticed ${a.signs.length} courier-scam warning signs.`)),
      ),
    );
    if (a.pauseMessage) card.append(el('h2', {}, `Message from ${a.pauseMessage.from}`), el('p', { class: 'big' }, `“${a.pauseMessage.text}”`));
    if (a.signs.length) card.append(el('h2', {}, 'Why'), signsList(a.signs));
  }

  if (p.summary) card.append(el('p', { class: 'note' }, p.summary));
  if (p.message) card.append(el('p', { class: 'big', role: 'status' }, p.message));

  if (a.status === 'active' && a.kind !== 'expected') {
    const call = el('button', { class: 'primary' }, `Call ${a.caregiverName}`) as HTMLButtonElement;
    const known = el('button', {}, 'I know this person') as HTMLButtonElement;
    const dismiss = el('button', {}, 'Dismiss') as HTMLButtonElement;
    const act = (b: HTMLButtonElement, action: string) => () => callAndRender(ctx, b, 'kinwise_respond_to_alert', { alertId: a.id, action });
    call.addEventListener('click', act(call, 'call_family'));
    known.addEventListener('click', act(known, 'known_person'));
    dismiss.addEventListener('click', act(dismiss, 'dismiss'));
    card.append(el('div', { class: 'actions' }, call, known, dismiss));
    queueMicrotask(() => call.focus());
  } else if (a.resolution) {
    const what = a.resolution === 'call_family' ? `Call ${a.caregiverName}` : a.resolution === 'known_person' ? 'I know this person' : 'Dismiss';
    card.append(el('p', { class: 'note' }, `Chose “${what}” at ${a.resolvedLabel}.`));
  }
  card.append(el('p', { class: 'note' }, 'Kinwise advises; it never locks doors or calls anyone without you.'));
  return card;
}

mountCard('pause', render);

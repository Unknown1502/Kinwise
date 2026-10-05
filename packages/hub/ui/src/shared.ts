import { App } from '@modelcontextprotocol/ext-apps';
import './style.css';

type Child = Node | string | number | false | null | undefined;

/** Tiny safe DOM builder: text is always set via text nodes, never innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void) | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const SHIELD = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6l20 8v15c0 14-9 23-20 28C21 52 12 43 12 29V14z" fill="currentColor" opacity=".9"/><path d="M23 32l6 6 12-13" stroke="#14261b" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function brand(subtitle: string): HTMLElement {
  const b = el('div', { class: 'brand' });
  const icon = el('span', { 'aria-hidden': 'true' });
  icon.innerHTML = SHIELD; // static, trusted markup
  b.append(icon, `Kinwise · ${subtitle}`);
  return b;
}

export const LEVEL_TEXT = {
  none: { icon: '✓', title: 'No warning signs' },
  elevated: { icon: '!', title: 'Some warning signs' },
  high: { icon: '⏸', title: 'Strong scam warning signs' },
} as const;

export interface Sign {
  key: string;
  label: string;
  explanation: string;
}

export function signsList(signs: Sign[]): HTMLElement {
  return el('ul', { class: 'signs' }, ...signs.map((s) => el('li', {}, el('strong', {}, s.label), s.explanation)));
}

export interface CardContext {
  app: App;
  /** Re-render with a new structured payload (e.g. after a button calls a server tool). */
  rerender: (data: unknown) => void;
}

/**
 * Connect to the MCP Apps host and render the tool's structuredContent.
 * Works in any MCP Apps host (Kinwise Echo Show simulator, Claude, VS Code…).
 */
export function mountCard(name: string, render: (data: any, ctx: CardContext) => Node): void {
  const root = document.getElementById('root')!;
  const app = new App({ name: `kinwise-${name}`, version: '0.1.0' }, {}, { autoResize: true });

  const applyTheme = () => {
    const theme = app.getHostContext()?.theme;
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  };

  const show = (data: unknown) => {
    root.replaceChildren(render(data, ctx));
  };
  const ctx: CardContext = { app, rerender: show };

  root.replaceChildren(el('div', { class: 'card' }, brand(name), el('p', { class: 'muted' }, 'Loading…')));

  app.ontoolresult = (result) => {
    if (result.isError) {
      const msg = (result.content ?? []).map((c) => ('text' in c ? c.text : '')).join(' ');
      root.replaceChildren(el('div', { class: 'card' }, brand(name), el('p', {}, msg || 'Something went wrong.')));
      return;
    }
    show(result.structuredContent ?? {});
  };
  app.onhostcontextchanged = () => applyTheme();

  app
    .connect()
    .then(applyTheme)
    .catch((err: unknown) => {
      root.replaceChildren(el('div', { class: 'card' }, brand(name), el('p', {}, `Could not connect to the host: ${String(err)}`)));
    });
}

/** Call a server tool from a card button and re-render with its structured result. */
export async function callAndRender(
  ctx: CardContext,
  button: HTMLButtonElement,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'One moment…';
  try {
    const result = await ctx.app.callServerTool({ name, arguments: args });
    if (result.isError) throw new Error((result.content ?? []).map((c) => ('text' in c ? c.text : '')).join(' '));
    ctx.rerender(result.structuredContent ?? {});
  } catch (err) {
    button.disabled = false;
    button.textContent = label;
    button.after(el('p', { class: 'muted', role: 'alert' }, err instanceof Error ? err.message : 'That did not work.'));
  }
}

/**
 * MCP Apps host for one card: a sandboxed srcdoc iframe + an AppBridge from
 * @modelcontextprotocol/ext-apps.
 *
 * Security: the card's HTML (from the server's ui:// resource) only ever runs
 * inside `<iframe sandbox="allow-scripts allow-forms">` (no allow-same-origin,
 * so it gets an opaque origin and cannot touch this page, its storage or its
 * tokens). The host never injects server data with innerHTML.
 *
 * Sequencing (mirrors the official basic-host example, minus its proxy iframe):
 *   1. create the iframe (no content yet) so it has a contentWindow;
 *   2. create the AppBridge with our connected MCP client, register handlers;
 *   3. bridge.connect(PostMessageTransport(contentWindow, contentWindow));
 *   4. only then set srcdoc, so the view's ui/initialize can never be missed;
 *   5. on `initialized`: sendToolInput(arguments) then sendToolResult(result).
 * Card buttons call server tools via App.callServerTool → AppBridge →
 * our MCP client → the hub. That forwarding is AppBridge's own (installed in
 * connect() because we pass a client); we only observe it through a thin
 * client proxy so the drawer can show card actions and Alexa can voice them.
 */
import type { CallToolResult, Client } from '@modelcontextprotocol/client';
import { AppBridge, PostMessageTransport, type McpUiDisplayMode, type McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge';
import { HOST_INFO } from './mcpSession';
import type { ToolResult } from './concierge';

export const CARD_SANDBOX = 'allow-scripts allow-forms';
/** Inline cards taller than this scroll inside their frame (like a touch display). */
export const DEFAULT_MAX_INLINE_HEIGHT = 520;

export type CardStatus = 'loading' | 'ready' | 'error';

export type BridgeEvent =
  | { type: 'initialized'; app?: string }
  | { type: 'tool-input'; toolName: string }
  | { type: 'tool-result'; toolName: string }
  | { type: 'card-tool-call'; name: string; arguments: Record<string, unknown> }
  | { type: 'card-tool-result'; name: string; isError: boolean; ms: number; result: unknown }
  | { type: 'display-mode'; mode: McpUiDisplayMode }
  | { type: 'open-link'; url: string; allowed: boolean }
  | { type: 'message'; text: string }
  | { type: 'log'; level: string; data: unknown }
  | { type: 'teardown' };

export interface CardHostOptions {
  container: HTMLElement;
  html: string;
  client: Client;
  title: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: ToolResult;
  maxInlineHeight?: number;
  onStatus?: (status: CardStatus, message?: string) => void;
  /** The view asked for a display mode; return the mode the host actually applied. */
  onDisplayModeRequest?: (mode: McpUiDisplayMode) => McpUiDisplayMode;
  onEvent?: (e: BridgeEvent) => void;
  /** A card button called a server tool and it completed. */
  onCardToolResult?: (name: string, args: Record<string, unknown>, result: CallToolResult) => void;
  /** The view sent a ui/message (e.g. "ask Alexa…"). */
  onMessage?: (text: string) => void;
  initTimeoutMs?: number;
}

/** Normalise a tool result for the view (content is required by the MCP schema). */
export function toCallToolResult(result: ToolResult): CallToolResult {
  return { ...(result as Record<string, unknown>), content: (result.content ?? []) as CallToolResult['content'] } as CallToolResult;
}

/** Only plain web links may be opened, in a new tab without opener. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Inline iframe height: the view's reported content height, capped (the frame scrolls beyond it). */
export function inlineHeight(reported: number, max: number, fallback = 180): number {
  if (!Number.isFinite(reported) || reported <= 0) return fallback;
  return Math.min(Math.ceil(reported), max);
}

type RequestFn = (request: { method: string; params?: Record<string, unknown> }, ...rest: unknown[]) => Promise<unknown>;

/**
 * A transparent proxy of the MCP client that reports `tools/call` requests made
 * through it. Every other member is the real client's, bound to it.
 */
export function observeToolCalls(
  client: Client,
  hooks: {
    onCall: (name: string, args: Record<string, unknown>) => void;
    onResult: (name: string, args: Record<string, unknown>, result: CallToolResult, ms: number) => void;
  },
): Client {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === 'request' && typeof value === 'function') {
        const request = (value as RequestFn).bind(target);
        const observed: RequestFn = (req, ...rest) => {
          if (req?.method !== 'tools/call') return request(req, ...rest);
          const name = String(req.params?.name ?? '');
          const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
          hooks.onCall(name, args);
          const started = performance.now();
          const p = request(req, ...rest);
          p.then(
            (result) => hooks.onResult(name, args, result as CallToolResult, performance.now() - started),
            () => undefined, // the bridge reports the error to the view
          );
          return p;
        };
        return observed;
      }
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export class CardHost {
  readonly iframe: HTMLIFrameElement;
  private bridge?: AppBridge;
  private disposed = false;
  private initialized = false;
  private displayMode: McpUiDisplayMode = 'inline';
  private reportedHeight = 0;
  private readonly maxInline: number;
  private hostContext: McpUiHostContext;
  private resizeObserver?: ResizeObserver;
  private initTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly opts: CardHostOptions) {
    this.maxInline = opts.maxInlineHeight ?? DEFAULT_MAX_INLINE_HEIGHT;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', CARD_SANDBOX);
    iframe.setAttribute('title', opts.title);
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.className = 'card-iframe';
    iframe.style.height = '180px';
    this.iframe = iframe;
    this.hostContext = {
      theme: 'dark',
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
      platform: 'web',
      locale: 'en-US',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceCapabilities: { touch: true, hover: false },
      userAgent: `${HOST_INFO.name}/${HOST_INFO.version}`,
      containerDimensions: { maxHeight: this.maxInline },
    };
  }

  async start(): Promise<void> {
    const { container, client } = this.opts;
    container.append(this.iframe); // contentWindow exists from here (about:blank)
    const win = this.iframe.contentWindow;
    if (!win) throw new Error('The card frame could not be created');

    const width = Math.round(container.clientWidth);
    if (width > 0) this.hostContext = { ...this.hostContext, containerDimensions: { width, maxHeight: this.maxInline } };

    const observed = observeToolCalls(client, {
      onCall: (name, args) => this.opts.onEvent?.({ type: 'card-tool-call', name, arguments: args }),
      onResult: (name, args, result, ms) => {
        this.opts.onEvent?.({ type: 'card-tool-result', name, isError: !!result.isError, ms, result });
        if (!this.disposed) this.opts.onCardToolResult?.(name, args, result);
      },
    });

    const bridge = new AppBridge(
      observed,
      { name: HOST_INFO.name, version: HOST_INFO.version },
      { serverTools: {}, serverResources: {}, openLinks: {}, logging: {}, message: { text: {} } },
      { hostContext: this.hostContext },
    );
    this.bridge = bridge;
    this.registerHandlers(bridge);

    this.opts.onStatus?.('loading');
    await bridge.connect(new PostMessageTransport(win, win));
    if (this.disposed) {
      await bridge.close().catch(() => undefined);
      return;
    }

    this.resizeObserver = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0 && this.initialized) this.updateContext({ containerDimensions: { width: w, maxHeight: this.currentMaxHeight() } });
    });
    this.resizeObserver.observe(container);

    this.initTimer = setTimeout(() => {
      if (!this.initialized && !this.disposed) this.opts.onStatus?.('error', "This card didn't start. The answer above still stands.");
    }, this.opts.initTimeoutMs ?? 10_000);

    // Load the view only now that the bridge is listening.
    this.iframe.srcdoc = this.opts.html;
  }

  private currentMaxHeight(): number {
    return this.displayMode === 'fullscreen' ? Math.max(this.iframe.clientHeight, this.maxInline) : this.maxInline;
  }

  private registerHandlers(bridge: AppBridge): void {
    const { opts } = this;
    bridge.addEventListener('initialized', () => {
      if (this.disposed) return;
      this.initialized = true;
      clearTimeout(this.initTimer);
      opts.onEvent?.({ type: 'initialized', app: bridge.getAppVersion()?.name });
      void (async () => {
        try {
          await bridge.sendToolInput({ arguments: opts.arguments });
          opts.onEvent?.({ type: 'tool-input', toolName: opts.toolName });
          await bridge.sendToolResult(toCallToolResult(opts.result));
          opts.onEvent?.({ type: 'tool-result', toolName: opts.toolName });
          opts.onStatus?.('ready');
        } catch (err) {
          opts.onStatus?.('error', err instanceof Error ? err.message : 'The card could not be updated.');
        }
      })();
    });

    bridge.addEventListener('sizechange', ({ height }) => {
      if (height === undefined || height === null || height <= 0) return;
      this.reportedHeight = Math.ceil(height);
      if (this.displayMode === 'inline') this.iframe.style.height = `${inlineHeight(this.reportedHeight, this.maxInline)}px`;
    });

    bridge.addEventListener('loggingmessage', ({ level, data }) => opts.onEvent?.({ type: 'log', level, data }));
    bridge.addEventListener('requestteardown', () => opts.onEvent?.({ type: 'teardown' }));

    bridge.onrequestdisplaymode = async ({ mode }) => {
      const wanted: McpUiDisplayMode = mode === 'fullscreen' ? 'fullscreen' : 'inline';
      const applied = opts.onDisplayModeRequest?.(wanted) ?? this.displayMode;
      this.applyDisplayMode(applied);
      opts.onEvent?.({ type: 'display-mode', mode: applied });
      return { mode: applied };
    };

    bridge.onopenlink = async ({ url }) => {
      const allowed = isSafeExternalUrl(url);
      opts.onEvent?.({ type: 'open-link', url, allowed });
      if (!allowed) return { isError: true };
      window.open(url, '_blank', 'noopener,noreferrer');
      return {};
    };

    bridge.onmessage = async ({ content }) => {
      const text = (content ?? [])
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join(' ')
        .trim();
      if (!text) return { isError: true };
      opts.onEvent?.({ type: 'message', text });
      opts.onMessage?.(text);
      return {};
    };
  }

  private updateContext(patch: Partial<McpUiHostContext>): void {
    this.hostContext = { ...this.hostContext, ...patch };
    try {
      this.bridge?.setHostContext(this.hostContext);
    } catch {
      /* the view may already be gone */
    }
  }

  private applyDisplayMode(mode: McpUiDisplayMode): void {
    this.displayMode = mode;
    this.iframe.style.height = mode === 'fullscreen' ? '100%' : `${inlineHeight(this.reportedHeight, this.maxInline)}px`;
    if (this.initialized) {
      this.updateContext({
        displayMode: mode,
        containerDimensions: { width: Math.round(this.iframe.clientWidth) || 600, maxHeight: this.currentMaxHeight() },
      });
    }
  }

  /** Host-initiated display mode change (the Expand / Exit buttons). */
  setDisplayMode(mode: McpUiDisplayMode): void {
    if (mode === this.displayMode) return;
    this.applyDisplayMode(mode);
    this.opts.onEvent?.({ type: 'display-mode', mode });
  }

  /** Tear down: ask the view to finish (bounded wait), close the bridge, remove the iframe. */
  async dispose(opts: { graceful?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.initTimer);
    this.resizeObserver?.disconnect();
    const bridge = this.bridge;
    if (bridge && opts.graceful && this.initialized && this.iframe.isConnected) {
      await bridge.teardownResource({}, { timeout: 800 }).catch(() => undefined);
    }
    await bridge?.close().catch(() => undefined);
    this.iframe.removeAttribute('srcdoc');
    this.iframe.remove();
  }
}

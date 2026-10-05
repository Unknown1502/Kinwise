// Placeholder. Run `npm run build:ui -w @kinwise/hub` to generate the real MCP Apps cards.
const stub = (name: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Kinwise ${name}</title></head><body><p>Kinwise ${name} card — run npm run build:ui</p></body></html>`;

export const UI_HTML = {
  screening: stub('screening'),
  today: stub('today'),
  pause: stub('pause'),
  timeline: stub('timeline'),
} as const;

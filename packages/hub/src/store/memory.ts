import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HouseholdState } from '../domain/types.js';
import { ConflictError, type Store } from './store.js';

/**
 * In-memory store for local development and tests. With `filePath` set it
 * persists to a JSON file so a dev restart keeps the demo state.
 */
export class MemoryStore implements Store {
  private readonly docs = new Map<string, string>();

  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) {
      const saved = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, HouseholdState>;
      for (const [id, state] of Object.entries(saved)) this.docs.set(id, JSON.stringify(state));
    }
  }

  async load(householdId: string): Promise<HouseholdState | undefined> {
    const raw = this.docs.get(householdId);
    return raw ? (JSON.parse(raw) as HouseholdState) : undefined;
  }

  async save(state: HouseholdState, expectedVersion: number): Promise<void> {
    const id = state.household.id;
    const raw = this.docs.get(id);
    const current = raw ? (JSON.parse(raw) as HouseholdState).version : 0;
    if (current !== expectedVersion) throw new ConflictError(id);
    this.docs.set(id, JSON.stringify(state));
    this.flush();
  }

  private flush(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const all = Object.fromEntries([...this.docs].map(([id, raw]) => [id, JSON.parse(raw)]));
    writeFileSync(this.filePath, JSON.stringify(all, null, 2));
  }
}

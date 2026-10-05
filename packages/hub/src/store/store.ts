import type { HouseholdState } from '../domain/types.js';

export class ConflictError extends Error {
  constructor(householdId: string) {
    super(`Concurrent update to household ${householdId}`);
    this.name = 'ConflictError';
  }
}

/** Household-scoped document store with optimistic concurrency on `version`. */
export interface Store {
  load(householdId: string): Promise<HouseholdState | undefined>;
  /** Persists `state` only if the stored version equals `expectedVersion` (0 = must not exist). */
  save(state: HouseholdState, expectedVersion: number): Promise<void>;
}

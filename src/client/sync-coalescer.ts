import type { ActualClient } from './actual-client.js';

export class SyncCoalescer {
  #lastSyncAt: Date | null = null;
  #lastSyncSucceeded = false;
  #inFlight: Promise<void> | null = null;

  constructor(
    private readonly sdk: Pick<ActualClient, 'sync'>,
    private readonly windowMs = 2000,
  ) {}

  get lastSyncAt(): Date | null {
    return this.#lastSyncAt;
  }

  get lastSyncSucceeded(): boolean {
    return this.#lastSyncSucceeded;
  }

  maybeSync(): Promise<void> {
    if (
      this.#lastSyncAt &&
      Date.now() - this.#lastSyncAt.getTime() < this.windowMs &&
      this.#lastSyncSucceeded
    ) {
      return Promise.resolve();
    }
    if (this.#inFlight) return this.#inFlight;

    this.#inFlight = this.sdk
      .sync()
      .then(() => {
        this.#lastSyncAt = new Date();
        this.#lastSyncSucceeded = true;
      })
      .catch((err: unknown) => {
        this.#lastSyncSucceeded = false;
        throw err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        this.#inFlight = null;
      });

    return this.#inFlight;
  }
}

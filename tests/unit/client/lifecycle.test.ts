import { describe, it, expect } from 'vitest';
import { withRetriedSync } from '../../../src/client/lifecycle.js';

describe('withRetriedSync', () => {
  it('retries up to 3 times then throws', async () => {
    let calls = 0;
    const sync = async (): Promise<void> => {
      await Promise.resolve();
      calls++;
      throw new Error('network');
    };
    await expect(withRetriedSync(sync)).rejects.toThrow(/network/);
    expect(calls).toBe(3);
  });

  it('returns immediately on success', async () => {
    let calls = 0;
    await withRetriedSync(async () => {
      await Promise.resolve();
      calls++;
    });
    expect(calls).toBe(1);
  });

  it('succeeds on second attempt', async () => {
    let calls = 0;
    await withRetriedSync(async () => {
      await Promise.resolve();
      calls++;
      if (calls === 1) throw new Error('flake');
    });
    expect(calls).toBe(2);
  });
});

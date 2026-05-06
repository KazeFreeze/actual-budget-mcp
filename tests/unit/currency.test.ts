import { describe, it, expect } from 'vitest';
import { currencyCodeToSymbol } from '../../src/currency.js';

describe('currencyCodeToSymbol', () => {
  it('maps USD to $', () => {
    expect(currencyCodeToSymbol('USD')).toBe('$');
  });

  it('maps PHP to ₱', () => {
    expect(currencyCodeToSymbol('PHP')).toBe('₱');
  });

  it('maps EUR to €', () => {
    expect(currencyCodeToSymbol('EUR')).toBe('€');
  });

  it('returns the input code when Intl rejects it (fallback)', () => {
    // "ZZZ" is reserved as a non-currency in ISO 4217 — Intl throws RangeError.
    expect(currencyCodeToSymbol('ZZZ')).toBe('ZZZ');
  });

  it('returns the input code for empty/garbage input rather than throwing', () => {
    expect(currencyCodeToSymbol('NOT_A_CODE')).toBe('NOT_A_CODE');
  });
});

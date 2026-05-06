/**
 * Currency helpers.
 *
 * `currencyCodeToSymbol` maps an ISO 4217 currency code (e.g. "USD", "PHP",
 * "EUR") to its localised display symbol via `Intl.NumberFormat`. If the
 * runtime's ICU data does not recognise the code (RangeError), we fall back
 * to returning the code itself — better than crashing or emitting "$" for a
 * non-USD budget.
 */
export function currencyCodeToSymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
    }).formatToParts(0);
    const symbol = parts.find((p) => p.type === 'currency')?.value;
    return symbol ?? code;
  } catch {
    return code;
  }
}

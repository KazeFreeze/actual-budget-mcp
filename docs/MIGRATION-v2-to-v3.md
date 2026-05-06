# Migrating from v2 to v3

## What changed

The MCP server no longer emits a currency symbol in formatted amounts. `formatAmount` now returns plain numbers like `1,250.00` instead of `$1,250.00`. The `CURRENCY_SYMBOL` env var, the `currencySymbol` config field, and the `getCurrencyCode()` SDK call have been removed. Currency labeling is now the client's responsibility.

## What you need to do

- Remove `CURRENCY_SYMBOL` from your `.env` (the server now rejects unknown env vars, but this one will simply be ignored — no startup error).
- Remove the `CURRENCY_SYMBOL` line from `docker/docker-compose.yml` / `docker-compose.production.yml` if you set one.
- Add `Currency is <CODE> — display as <SYMBOL>.` to your client's instruction file (e.g. `CLAUDE.md`, `GEMINI.md`, system prompt). Example: `Currency is PHP — display as ₱.`

## Example: tool response before/after

Before (v2):

```
- **Income:** $5,000.00
- **Expenses:** -$400.00
- **Net:** $4,600.00
```

After (v3):

```
- **Income:** 5,000.00
- **Expenses:** -400.00
- **Net:** 4,600.00
```

With the client-side instruction in place, the LLM will prepend the right symbol when summarizing — and it will get it right for non-USD budgets, which the server's auto-detect could not.

## Why

See [`docs/superpowers/specs/2026-05-06-v3-currency-redesign.md`](superpowers/specs/2026-05-06-v3-currency-redesign.md) for the full rationale.

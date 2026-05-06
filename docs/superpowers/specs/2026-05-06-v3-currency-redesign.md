# v3 design note: drop currency-symbol from the MCP layer

> **Status:** Proposed for v3 (next breaking release). Not implemented in v2.
> **Date:** 2026-05-06

## Decision

In v3, the MCP server will **stop emitting a currency symbol** in formatted amounts. `formatAmount(125000)` will return `"1,250.00"`, not `"$1,250.00"` or `"₱1,250.00"`. The `CURRENCY_SYMBOL` env var, the `currencySymbol` config field, the `getCurrencyCode()` SDK call, and the `currency.ts` Intl mapping will all be removed.

Currency labeling becomes the **client's responsibility** — the LLM (Claude / Gemini / etc.) formats per the user's stated context, typically via a line in `CLAUDE.md` or a system prompt: e.g. *"Currency is PHP — display as ₱."*

## Why

The MCP server is a data API. Currency display is a presentation concern. Coupling them turned out to be an entire bug class:

| Approach (tried) | Failure mode |
|------------------|--------------|
| **v2.0**: hardcoded `$` default via env | Wrong for every non-USD user who didn't override |
| **v2.1**: auto-detect from Actual's `defaultCurrencyCode` preference | Field is new/experimental; older budgets don't have it set; UI doesn't expose it; silently falls back to `$` |
| **v2.x considered**: infer from `numberFormat` locale | Locale ≠ currency. `en-US` formatting is widely used in non-USD countries (PHP, MXN, AUD, CAD…). Wrong-guess rate would still force overrides |

Every approach above either gets it wrong by default or asks the user to configure something that the LLM client already knows. The data layer is the wrong place for this concern.

## Evidence

A real v2.1 deploy with a PHP-denominated budget logged:

```
{"symbol":"$","msg":"currency: no preference detected, using fallback"}
```

Auto-detect ran. The preference was unset. Fallback fired. User had to set `CURRENCY_SYMBOL=₱` anyway — same place we started. The auto-detect added complexity without removing the override.

## What changes in v3

- **Remove** `currencySymbol` field from config (and `CURRENCY_SYMBOL` env var).
- **Remove** `getCurrencyCode()` from `ActualClient` interface and both implementations.
- **Remove** `src/currency.ts` and its tests.
- **Remove** `currencySymbol` plumbing through `McpServerDeps`, `setupResources`, `createCrudTools`, `createQueryTool`, `createAnalyticsTools`.
- **Change** `formatAmount(amountInCents: number): string` signature: drops the `currencySymbol` parameter, returns just the formatted number.
- **Update** README + MIGRATION-v2-to-v3.md: explain that currency labeling lives in the client (CLAUDE.md / system prompt), not the server.
- **Behavior**: amounts in tool responses become `"1,250.00"` instead of `"$1,250.00"`. LLMs with currency context in their instructions will prepend the right symbol when summarizing.

## Trade-off

| Pro | Con |
|-----|-----|
| Eliminates an entire bug class | Users who don't set client-side currency context will see bare numbers |
| Removes ~3 modules + config field + 15 tests | LLM may default to "$" when summarizing if no context provided |
| Aligns with how Actual stores amounts (raw integers, currency-agnostic) | One-line UX regression for the unconfigured case |
| Frees us from chasing Actual's experimental preference fields | |

The unconfigured case is a one-time fix per user (add a line to `CLAUDE.md` or the system prompt). The bug class we eliminate keeps recurring as Actual's preference schema evolves.

## What v3 does **not** change

- All other tools, resources, prompts, transports, and auth.
- Amount precision (still integer cents internally, two-decimal output).
- Sign handling (negative for expenses, positive for income).

This is a focused, surgical breaking change. v3 is otherwise additive over v2.

## Migration path for users

Add to your client's instruction file (e.g. `CLAUDE.md`, `GEMINI.md`, system prompt):

```
Currency is <CODE> — display as <SYMBOL>.
```

That's it. No env var, no preference, no Dokploy edit.

## Open questions

- Should v3 retain a single optional env var (`CURRENCY_LABEL`) for users who want server-side labeling? Current lean: **no** — half-measures recreate the original problem.
- Timing: v3 is otherwise unscoped. This change alone may not warrant a major bump; could ride the next planned breaking release. Until then, v2.1's `CURRENCY_SYMBOL` override stays the supported workaround.

# Command Code Model Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent invalid Command Code `max_tokens` requests and refresh the bundled catalog to the 86 chat models currently returned by the live API.

**Architecture:** Keep the live Command Code catalog authoritative for model identity, context, and routes. Accept `max_output_tokens` when the API supplies it; otherwise use Command Code's official Pi-provider fallback of 32,768 tokens instead of borrowing a possibly incompatible donor limit. Continue using Pi donor records only for reasoning, modalities, and thinking compatibility.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Vitest, pnpm

**Spec:** Approved bounded design from the 2026-09-30 conversation; no separate design file was required.

## Global Constraints

- Touch only `src/providers/command-code/models.ts`, `src/providers/command-code.ts`, and `tests/providers/command-code.test.ts`.
- Add no dependency or new abstraction.
- Use the [live Command Code catalog](https://api.commandcode.ai/provider/v1/models) for IDs, names, contexts, and routes; use [Pricing & Limits](https://commandcode.ai/docs/resources/pricing-limits) for costs.
- Match the [official Command Code Pi provider](https://github.com/CommandCodeAI/pi-commandcode-provider) when the catalog omits output limits.
- Use exactly `32_768` when Command Code omits `max_output_tokens`.
- Clamp every output limit to the record's `contextWindow`.
- Keep the current donor-selection behavior for reasoning, input modalities, thinking maps, and Anthropic compatibility only.
- Preserve cached models when a live catalog contains invalid optional output-limit metadata.

## Review Focus

- A live record without `max_output_tokens` must produce `maxTokens: 32_768`, not a donor-derived value.
- A valid `max_output_tokens` larger than `context_length` must be clamped to the context window.
- Zero, negative, fractional, string, or otherwise invalid `max_output_tokens` values must reject the refresh and retain the cached catalog.
- DeepSeek V4.1 Flash and every other model must ignore oversized donor output limits.
- The bundled fallback must contain exactly the four newly live models with current routes and pricing.

---

### Task 1: Refresh the catalog and make output limits provider-owned

**Files:**
- Modify: `src/providers/command-code/models.ts`
- Modify: `src/providers/command-code.ts`
- Test: `tests/providers/command-code.test.ts`

**Interfaces:**
- Consumes: `CommandCodeCatalogRecord`, `modelFromCatalogRecord(record)`, and the existing live-catalog refresh path.
- Produces: `CommandCodeCatalogRecord.maxOutputTokens?: number`; live JSON field `max_output_tokens`; models whose `maxTokens` is `Math.min(record.maxOutputTokens ?? 32_768, record.contextWindow)`.

- [ ] **Step 1: Write failing conversion and snapshot tests**

Update the catalog-conversion tests to assert:

```ts
expect(
  modelFromCatalogRecord({
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    contextWindow: 1_000_000,
    supportedEndpoints: ["/chat/completions", "/responses"],
  }).maxTokens,
).toBe(32_768);

expect(
  modelFromCatalogRecord({
    id: "new/vendor-model",
    name: "New Vendor Model",
    contextWindow: 500_000,
    maxOutputTokens: 393_216,
    supportedEndpoints: ["/chat/completions"],
  }).maxTokens,
).toBe(393_216);

expect(
  modelFromCatalogRecord({
    id: "new/vendor-model",
    name: "New Vendor Model",
    contextWindow: 16_000,
    maxOutputTokens: 32_768,
    supportedEndpoints: ["/chat/completions"],
  }).maxTokens,
).toBe(16_000);
```

Change the bundled-catalog expectations from 82 to 86 and require these IDs:

```ts
[
  "claude-sonnet-5-5",
  "gpt-6.1-sol",
  "deepseek/deepseek-v4.1-flash-fast",
  "inclusionai/ling-3.1-flash:free",
]
```

Extend the pricing assertions with:

```ts
{
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-6.1-sol": {
    input: 2,
    output: 10,
    cacheRead: 0.1,
    cacheWrite: 2.5,
    tiers: [
      { inputTokensAbove: 272_000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 },
    ],
  },
  "deepseek/deepseek-v4.1-flash-fast": {
    input: 0.16,
    output: 0.58,
    cacheRead: 0.016,
    cacheWrite: 0,
  },
  "inclusionai/ling-3.1-flash:free": {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
}
```

Also update existing donor-metadata assertions so all records without an explicit Command Code limit expect `32_768`, or their smaller context window.

- [ ] **Step 2: Write failing live-parser tests**

Add `max_output_tokens: 24_000` to `validPayload` and assert the refreshed `new-model` has `maxTokens: 24_000`.

Add table cases for `max_output_tokens` values `0`, `-1`, `1.5`, and `"32768"`; each refresh must return a Command Code error and leave the cached model unchanged. Keep the existing missing-field case valid so it proves the 32K fallback path.

- [ ] **Step 3: Run the focused tests and confirm the new assertions fail**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts`

Expected: FAIL because `maxOutputTokens` is not represented or parsed, donor limits are still used, and the bundled catalog has 82 models.

- [ ] **Step 4: Implement the provider-owned max-output policy**

In `src/providers/command-code/models.ts`:

- Add `maxOutputTokens?: number` to `CommandCodeCatalogRecord`.
- Add `const COMMAND_CODE_FALLBACK_MAX_TOKENS = 32_768`.
- Set `maxTokens` to `Math.min(record.maxOutputTokens ?? COMMAND_CODE_FALLBACK_MAX_TOKENS, record.contextWindow)`.
- Do not use `donor.maxTokens` anywhere in the result.

In `src/providers/command-code.ts`:

- Destructure `max_output_tokens` from each live entry.
- Accept it only when absent or a positive integer.
- Map it to `maxOutputTokens` when present.

- [ ] **Step 5: Refresh the bundled snapshot and prices**

In `src/providers/command-code/models.ts`:

- Add the four live records with contexts and routes from `/provider/v1/models`: Sonnet 5.5 at `1_000_000` on `/messages`; GPT-6.1 Sol at `1_050_000`; DeepSeek V4.1 Flash Fast at `1_000_000`; Ling 3.1 Flash at `262_144`.
- Add `claude-sonnet-5-5` to `MESSAGES_MODEL_IDS`; the other three use the default `[/chat/completions, /responses]` routes.
- Add the exact costs from Step 1 and include Ling 3.1 in the zero-cost IDs test.
- Update the pricing snapshot date to `2026-09-30`.

- [ ] **Step 6: Run focused verification**

Run: `pnpm exec vitest run tests/providers/command-code.test.ts`

Expected: PASS for the Command Code test file.

- [ ] **Step 7: Run full verification**

Run: `pnpm check`

Expected: formatting, lint, typecheck, and all tests pass with exit code 0.

- [ ] **Step 8: Commit the implementation**

```bash
git add src/providers/command-code/models.ts src/providers/command-code.ts tests/providers/command-code.test.ts
git commit -m "fix: cap Command Code model output tokens"
```

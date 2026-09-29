# Phase 1: Command Code Catalog and Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh Command Code’s bundled and live chat catalog and route each model from its declared supported endpoint.

**Architecture:** Keep the existing three-file provider boundary. `models.ts` owns the bundled snapshot and converts validated catalog records; `command-code.ts` validates, filters, and refreshes live records; the existing persistence, throttling, ZDR, and donor metadata behavior remains unchanged.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai/compat`, native `fetch`, Vitest, Biome.

**Spec:** Command Code Provider API and live model catalog: https://commandcode.ai/docs/provider and https://api.commandcode.ai/provider/v1/models. Pricing source: https://commandcode.ai/docs/resources/pricing-limits.

## Global Constraints

- Keep Node `>=24.15.0` and the existing Pi peer dependency versions.
- Add no runtime or SDK dependency and do not add Responses API support.
- Keep the offline bundled snapshot and cached refresh behavior.
- Exclude `typesafe/jev`; System One is a separate decision endpoint, not a chat model.
- Use the durable post-promotion list rate for Grok 4.7: `2/6/.5/0`, with `4/12/1/0` above 200K context.
- Keep unknown future live models on the existing zero-cost fallback.

## Review Focus

- Missing, non-array, or non-string `supported_endpoints` metadata must reject the refresh and retain cached models.
- Valid records advertising only `/responses` or an unknown endpoint must be skipped without wiping usable records.
- A catalog with zero usable chat records must reject publication and retain the cache.
- Routing must follow endpoint declarations even when model IDs do not contain a vendor prefix.
- Temporary, tiered, and time-band prices must preserve the selected snapshot policy and Pi’s representable tiers.

---

### Task 1: Validate endpoint metadata and route models

**Files:**

- Modify: `src/providers/command-code/models.ts`
- Modify: `src/providers/command-code.ts`
- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Extend `CommandCodeCatalogRecord` with `supportedEndpoints: readonly string[]`.
- Keep `modelFromCatalogRecord(record)` as the conversion boundary.
- Select Anthropic Messages when `/messages` is advertised; otherwise select OpenAI Completions when `/chat/completions` is advertised.
- Treat `/messages` as higher priority when both supported routes appear.
- Keep `/responses`-only and unknown-endpoint records out of the Pi chat catalog.

- [ ] **Step 1: Add failing endpoint tests** for a non-Claude ID using `/messages`, a Claude-looking ID using `/chat/completions`, a record advertising both routes, unsupported endpoint filtering, malformed endpoint metadata, duplicate IDs, and a zero-usable-record payload.
- [ ] **Step 2: Run the focused test file** with `pnpm vitest run tests/providers/command-code.test.ts`; confirm the new endpoint assertions fail against prefix-based routing.
- [ ] **Step 3: Implement endpoint validation and filtering** in the live parser. Require an array of strings, preserve existing field validation, filter records without `/messages` or `/chat/completions`, reject an empty usable result, and leave refresh persistence/throttling unchanged.
- [ ] **Step 4: Implement endpoint-based conversion** in `modelFromCatalogRecord(record)` while preserving donor metadata, API compatibility, base URLs, ZDR handling, and unknown-cost fallback.
- [ ] **Step 5: Re-run the focused endpoint tests** and confirm routing, filtering, malformed refresh retention, and duplicate handling pass.
- [ ] **Step 6: Commit** with `git add src/providers/command-code.ts src/providers/command-code/models.ts tests/providers/command-code.test.ts && git commit -m "feat: route command code models by endpoints"`.

### Task 2: Refresh the 82-model snapshot and pricing

**Files:**

- Modify: `src/providers/command-code/models.ts`
- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Every bundled `CommandCodeCatalogRecord` includes `supportedEndpoints`.
- The snapshot contains 82 unique chat models: 9 `/messages`, 8 `/chat/completions` only, and 65 supporting both `/chat/completions` and `/responses`.

- [ ] **Step 1: Add failing snapshot assertions** for 82 records, endpoint-shape counts, the 22 additions, removal of `minimax/minimax-m3-free` and `minimax/minimax-m2.7-free`, the `stepfun/Step-3.5-Flash` context change to `262_144`, and the four free IDs: `stealth/space-bunny-alpha`, `stealth/pixel-canary`, `poolside/laguna-s-2.1-free`, and `inclusionai/ling-3.0-flash-sante:free`.
- [ ] **Step 2: Add table-driven price assertions** for all added models and corrected existing entries. Pin GPT-6 tiers at 272K, Grok 4.7 at the durable list rates and 200K tier, DeepSeek time-band comments, corrected DeepSeek/Step/Gemini rates, and existing missing tiers for GPT-5.6 Sol, Qwen 3.7 Plus, Qwen 3.7 Flash, and Grok 4.6.
- [ ] **Step 3: Run the new snapshot tests** with `pnpm vitest run tests/providers/command-code.test.ts`; confirm they fail against the current 62-record snapshot and dated prices.
- [ ] **Step 4: Replace the bundled records and costs** with the September 27, 2026 live catalog and pricing snapshot. Preserve donor lookup and conservative defaults for records without a Pi donor.
- [ ] **Step 5: Re-run the focused suite** and confirm catalog count, endpoint distribution, IDs, context windows, prices, tiers, free exceptions, live refresh, cache retention, throttling, cancellation, and ZDR tests pass.
- [ ] **Step 6: Run `pnpm check`** and confirm exit code 0. Existing unrelated Biome warnings in MiniMax files are out of scope; do not modify them.
- [ ] **Step 7: Commit** with `git add src/providers/command-code/models.ts tests/providers/command-code.test.ts && git commit -m "feat: refresh command code model catalog"`.

## Acceptance

Run `pnpm vitest run tests/providers/command-code.test.ts` and `pnpm check`. The provider must expose the 82-model chat snapshot, route from catalog endpoint declarations, preserve cached models after malformed or unusable refreshes, and keep existing authentication, ZDR, throttling, and cancellation behavior.

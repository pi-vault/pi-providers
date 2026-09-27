# Phase 1: Command Code Catalog and Routing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh Command Code’s model metadata and route requests from the live catalog’s endpoint declarations.

**Depends on:** None.

**Usable result:** The existing `command-code` provider serves the current supported catalog, retains cached data on malformed refreshes, and passes its focused tests.

**Files:**

- Modify: `src/providers/command-code/models.ts`
- Modify: `src/providers/command-code.ts`
- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Extend `CommandCodeCatalogRecord` with `supportedEndpoints: readonly string[]`.
- Keep `modelFromCatalogRecord(record)` as the conversion boundary.
- Route `/messages` records to Anthropic Messages; route records advertising `/chat/completions` to OpenAI Completions.
- Validate endpoint metadata, skip valid records with neither supported endpoint, and reject malformed records as refresh errors.

## Steps

- [ ] Add failing tests for endpoint-aware routing, unsupported-endpoint filtering, malformed endpoint metadata, the current 82-record snapshot, 22 current additions, removal of the two expired MiniMax free IDs, and current prices/free-model exceptions.
- [ ] Run `pnpm vitest run tests/providers/command-code.test.ts` and confirm the new assertions fail against the existing prefix-based 62-model implementation.
- [ ] Implement endpoint-aware conversion and replace the bundled records with the live 2026-09-27 catalog. Refresh prices from Command’s pricing page, preserve donor metadata and unknown-cost fallback, and leave refresh persistence/throttling unchanged.
- [ ] Re-run `pnpm vitest run tests/providers/command-code.test.ts` and confirm catalog, routing, cache-retention, and refresh tests pass.
- [ ] Commit with `git add src/providers/command-code.ts src/providers/command-code/models.ts tests/providers/command-code.test.ts && git commit -m "feat: refresh command code model catalog"`.


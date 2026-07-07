# Phase 9: Wire Into Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose `hardenToolCalls` and `normalizeToolResults` into the `minimax-openai` provider pipeline, completing the M3 tool hardening feature.

**Architecture:** Updates `streamSimple` in `minimax-openai.ts` to apply `normalizeToolResults(context)` before the driver call and wrap the base stream with `hardenToolCalls` before `cleanStream`. Final pipeline: `cleanStream(hardenToolCalls(base))` with pre-request `normalizeToolResults(context)`.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Vitest

**Spec:** `docs/superpowers/specs/2026-07-06-m3-tool-hardening-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-06-m3-tool-hardening.md` (Phase 6)

**Prerequisite:** All previous phases (4-8) must be complete. The following files must exist:
- `src/core/harden-tool-calls.ts` (Phases 4-6)
- `src/core/normalize-tool-results.ts` (Phase 8)
- `tests/core/harden-tool-calls.test.ts` (Phases 4-7)
- `tests/core/normalize-tool-results.test.ts` (Phase 8)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/providers/minimax-openai.ts` | Modify | Add imports, update `streamSimple` pipeline |

---

### Task 9: Wire `hardenToolCalls` and `normalizeToolResults` into the provider

**Files:**
- Modify: `src/providers/minimax-openai.ts`

- [ ] **Step 1: Update imports**

Add new imports to the top of `src/providers/minimax-openai.ts`, alongside the existing `cleanStream` import:

```typescript
import { hardenToolCalls } from "../core/harden-tool-calls.ts";
import { normalizeToolResults } from "../core/normalize-tool-results.ts";
```

- [ ] **Step 2: Update the `streamSimple` function**

In `src/providers/minimax-openai.ts`, find the existing `streamSimple` method:

```typescript
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const driver = getApiProvider("openai-completions");
      if (!driver) throw new Error("openai-completions api provider not registered");
      const base = driver.streamSimple(
        { ...model, api: "openai-completions" },
        context,
        options,
      );
      return cleanStream(base);
    },
```

Replace it with:

```typescript
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const driver = getApiProvider("openai-completions");
      if (!driver) throw new Error("openai-completions api provider not registered");
      const ctx = normalizeToolResults(context);
      const base = driver.streamSimple(
        { ...model, api: "openai-completions" },
        ctx,
        options,
      );
      return cleanStream(hardenToolCalls(base));
    },
```

Two changes:
1. `normalizeToolResults(context)` applied before the driver call (pre-request reordering)
2. `hardenToolCalls(base)` wraps the base stream before `cleanStream` (post-response hardening)

- [ ] **Step 3: Verify the `Context` import**

The `Context` type is already imported in the existing `streamSimple` signature. Verify it's in the import line from `@earendil-works/pi-ai`. The existing import should look like:

```typescript
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  OpenAICompletionsCompat,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
```

If `Context` is missing, add it.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: ALL PASS (existing tests + all new hardenToolCalls and normalizeToolResults tests)

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `pnpm run lint`
Expected: No errors. If formatting issues, run `pnpm run format` first, then re-run lint.

- [ ] **Step 7: Commit**

```bash
git add src/providers/minimax-openai.ts
git commit -m "feat: wire hardenToolCalls and normalizeToolResults into provider pipeline"
```

### Task 10: Final verification

- [ ] **Step 1: Run the full check suite**

Run: `pnpm run check`
Expected: lint + typecheck + tests all pass

- [ ] **Step 2: Review the diff**

Run: `git diff main...HEAD --stat` and `git log --oneline main...HEAD`
Verify:
- 4 new files created (2 source, 2 test):
  - `src/core/harden-tool-calls.ts`
  - `src/core/normalize-tool-results.ts`
  - `tests/core/harden-tool-calls.test.ts`
  - `tests/core/normalize-tool-results.test.ts`
- 1 file modified:
  - `src/providers/minimax-openai.ts`
- No unrelated changes

- [ ] **Step 3: Final commit if any formatting changes**

```bash
git add -A
git status  # should be clean
```

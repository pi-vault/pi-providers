# MiniMax Leaked Tool-Markup Rejection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both MiniMax OpenAI-compatible providers fail closed when MiniMax emits the undocumented raw-text sentinel `]<]minimax[>[<`, while preserving safe output and allowing Pi’s existing bounded retry flow to recover.

**Architecture:** Extend the shared `cleanStream` wrapper with a small rolling detector at the raw `text_delta` boundary, before `ThinkScanner`. Safe text continues through the existing thinking/text cleanup; a complete sentinel closes already-open output, emits one sanitized retryable provider error, and suppresses all later stream content. Native structured tool calls remain unchanged.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` 0.80.6, Vitest, pnpm.

---

## Scope and fixed behavior

- Match only the exact, case-sensitive sentinel `]<]minimax[>[<`.
- Detect the sentinel even when split across `text_delta` events.
- Preserve all confirmed-safe text before the sentinel, including a partial `<think>` tag buffered by `ThinkScanner`.
- Suppress the sentinel and every byte after it.
- Close an open visible text block and thinking segment before the terminal error.
- Emit exactly one error message:

  ```text
  MiniMax returned malformed tool-call markup. Please retry your request.
  ```

  The wording intentionally matches Pi AI 0.80.6’s exported `isRetryableAssistantError()` classifier. The provider does not add its own retry loop; Pi’s existing retry settings, backoff, cancellation, and disabled-retry behavior remain authoritative.

- Log exactly `[minimax-openai] leaked tool-call markup detected`; never log response content, the marker, tool arguments, or post-marker text.
- Do not parse or execute the undocumented markup, add dependencies, change Pi core, or edit the standalone `minimax-m3-clean.ts`.
- The shared `cleanStream` path covers both `minimax-openai` and `minimax-openai-cn`.

## Files and responsibilities

- Modify `tests/providers/minimax-openai/clean-stream.test.ts` for red/green stream regressions, logging privacy, and retry classification.
- Modify `src/providers/minimax-openai/clean-stream.ts` for the rolling raw-text detector and terminal error path.
- Modify `CHANGELOG.md` with an `[Unreleased]` fixed entry.

### Task 1: Add deterministic failing regressions

**Files:**

- Modify: `tests/providers/minimax-openai/clean-stream.test.ts`

- [ ] **Step 1: Add the required imports and leak-test constants.**

Import `vi` from Vitest and `isRetryableAssistantError` from `@earendil-works/pi-ai`. Define the test sentinel and post-marker secret locally so assertions do not depend on implementation-private constants.

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  isRetryableAssistantError,
} from "@earendil-works/pi-ai";

const leakedSentinel = "]<]minimax[>[<";
const postMarkerSecret = "secret-after-marker";
```

Keep the existing type-only import and test helpers unchanged.

- [ ] **Step 2: Add the complete-leak regression.**

Use `makePartial`, `pushEvents`, and `collectEvents`. Spy on `console.error` and restore it in the test. Feed a safe preamble followed by the sentinel and fake markup:

```ts
const leaked =
  "Preparing the edit. " +
  leakedSentinel +
  '<invoke name="write">' +
  leakedSentinel +
  "<path>src/file.ts</path>" +
  leakedSentinel +
  "</invoke>" +
  postMarkerSecret;
```

Assert the emitted event types are `start`, `text_start`, `text_delta`, `text_end`, `error`; assert no `done` event exists; assert the joined text deltas equal `"Preparing the edit. "`; assert the error content contains neither the sentinel nor the secret; assert the error message is the exact contract string; assert `isRetryableAssistantError(error.error)` is true; and assert the log spy received exactly `[minimax-openai] leaked tool-call markup detected` with no extra arguments.

- [ ] **Step 3: Add a split-boundary regression.**

Create one test that loops over every split position from `1` through `leakedSentinel.length - 1`. For each position, create a fresh base stream and send:

```ts
const safePrefix = "safe<thi";
const first = safePrefix + leakedSentinel.slice(0, split);
const second = leakedSentinel.slice(split) + "<invoke>" + postMarkerSecret;
```

Assert each stream emits a terminal `error`, never `done`, preserves `safe<thi` in emitted safe text, and excludes the marker and post-marker secret. The `<thi` suffix proves the error path flushes `ThinkScanner`’s own partial-tag buffer.

- [ ] **Step 4: Add incomplete-marker passthrough coverage.**

Send ordinary text ending in `"]<]mini"`, then `text_end` and `done`. Assert the incomplete suffix is present in text deltas and the terminal event remains `done`, not `error`.

- [ ] **Step 5: Add the raw-before-thinking regression.**

Send a text delta containing `<think>reasoning` followed by the complete sentinel and arbitrary payload. Assert the stream emits `error`, not `done`, and no emitted thinking or error content contains the sentinel or payload. This prevents future code from placing detection after `ThinkScanner`.

- [ ] **Step 6: Run the focused tests and verify the red state.**

Run:

```bash
pnpm vitest run tests/providers/minimax-openai/clean-stream.test.ts
```

Expected: existing tests pass; complete-leak, split-boundary, and raw-before-thinking regressions fail because the current cleaner forwards the marker and emits `done`.

### Task 2: Implement the minimal raw-text detector

**Files:**

- Modify: `src/providers/minimax-openai/clean-stream.ts`

- [ ] **Step 1: Add constants and per-text-state buffering.**

Add these module-level constants and add `leakedToolMarkupBuffer: string` to `TextState`:

```ts
const LEAKED_TOOL_MARKUP_SENTINEL = "]<]minimax[>[<";
const LEAKED_TOOL_MARKUP_ERROR =
  "MiniMax returned malformed tool-call markup. Please retry your request.";
```

Initialize the buffer to `""` in the existing `text_start` state creation. Do not export the constants or create a new module.

- [ ] **Step 2: Add split-safe scan and flush helpers.**

Add internal helpers in `clean-stream.ts`:

```ts
function scanLeakedToolMarkup(
  state: TextState,
  chunk: string,
): { text: string; leaked: boolean } {
  const combined = state.leakedToolMarkupBuffer + chunk;
  const index = combined.indexOf(LEAKED_TOOL_MARKUP_SENTINEL);
  if (index >= 0) {
    state.leakedToolMarkupBuffer = "";
    return { text: combined.slice(0, index), leaked: true };
  }

  let keep = 0;
  const max = Math.min(LEAKED_TOOL_MARKUP_SENTINEL.length - 1, combined.length);
  for (let size = max; size > 0; size--) {
    if (combined.endsWith(LEAKED_TOOL_MARKUP_SENTINEL.slice(0, size))) {
      keep = size;
      break;
    }
  }
  state.leakedToolMarkupBuffer = combined.slice(combined.length - keep);
  return { text: combined.slice(0, combined.length - keep), leaked: false };
}

function flushLeakedToolMarkup(state: TextState): string {
  const buffered = state.leakedToolMarkupBuffer;
  state.leakedToolMarkupBuffer = "";
  return buffered;
}
```

The detector must retain only a possible sentinel prefix; ordinary text is emitted immediately.

- [ ] **Step 3: Add small internal routing/closing helpers.**

Factor the repeated existing logic into local helpers without changing behavior:

- Add `routeSafeText(state: TextState, raw: string): void` to call `state.scanner.feed`, then `pushInlineThinking` and `pushText` in the existing order.
- Add `flushScanner(state: TextState): void` to call `state.scanner.flush`, then route its thinking and text output.
- Add `closeText(state: TextState): void` to trim a started text block and emit `text_end`.

The leak path must route the safe prefix, flush `ThinkScanner`, close text, then close the thinking segment. This order preserves a safe partial `<think>` tag and leaves no open output block before `error`.

- [ ] **Step 4: Scan raw `text_delta` data before `ThinkScanner`.**

Replace the direct `state.scanner.feed(ev.delta)` call with:

```ts
const scanned = scanLeakedToolMarkup(state, ev.delta);
routeSafeText(state, scanned.text);
if (scanned.leaked) {
  flushScanner(state);
  closeText(state);
  closeSegment();
  console.error("[minimax-openai] leaked tool-call markup detected");
  if (!output) return;
  out.push({
    type: "error",
    reason: "error",
    error: {
      ...output,
      stopReason: "error",
      errorMessage: LEAKED_TOOL_MARKUP_ERROR,
    },
  });
  return;
}
```

Keep `syncMeta(ev.partial)` before scanning so the sanitized error retains the latest provider metadata. Returning from the wrapper prevents later upstream `done` or `error` events from escaping or mutating the finalized output.

- [ ] **Step 5: Flush incomplete detector state at `text_end`.**

At normal `text_end`, route `flushLeakedToolMarkup(state)` through `ThinkScanner`, flush `ThinkScanner`, then close the text block using the existing trimming behavior. Do not inspect `ev.content`; all streamed bytes must continue to come from deltas, as in the current implementation.

- [ ] **Step 6: Run focused tests and type/lint checks.**

Run:

```bash
pnpm vitest run tests/providers/minimax-openai/clean-stream.test.ts
pnpm typecheck
pnpm lint
```

Expected: all focused tests pass; typecheck and lint complete successfully without new diagnostics.

- [ ] **Step 7: Commit the implementation and regressions.**

```bash
git add src/providers/minimax-openai/clean-stream.ts tests/providers/minimax-openai/clean-stream.test.ts
git commit -m "fix: reject leaked MiniMax tool markup"
```

### Task 3: Document and verify the release surface

**Files:**

- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the unreleased changelog entry.**

Insert this above `## [0.2.0]`:

```markdown
## [Unreleased]

### Fixed

- Fail closed with a retryable provider error when MiniMax-M3 emits internal tool-call markup instead of OpenAI tool calls.
```

Use the existing Keep a Changelog bracket style.

- [ ] **Step 2: Run merge-ready verification under the declared Node version.**

Run:

```bash
mise exec node@24.15.0 -- pnpm release:check
git diff --check
git status --short
```

`release:check` runs the repository lint, typecheck, complete Vitest suite, and package dry-run. Expected: all commands succeed; status shows only the intended implementation, test, changelog, and plan-document changes.

- [ ] **Step 3: Commit the changelog.**

```bash
git add CHANGELOG.md
git commit -m "docs: record MiniMax tool-markup rejection"
```

## Self-review checklist

- Exact sentinel, every split boundary, incomplete suffix, and sentinel-inside-thinking behavior are covered.
- Safe text before the marker, including `ThinkScanner`’s buffered partial tag, is preserved.
- Error content is sanitized and retry-classified by the locked Pi AI dependency.
- Native structured tool calls and upstream errors remain on their existing branches.
- Both MiniMax variants use the shared cleaner, so no duplicate provider-specific implementation is needed.
- No automatic retry loop, parser, dependency, Pi core change, or standalone cleaner edit is introduced.
- No placeholders, undefined helper names, or contradictory event-order requirements remain.

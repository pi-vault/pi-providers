# M3 Tool Hardening Design

**Date:** 2026-07-06
**Status:** Draft
**Scope:** Four enhancements to the `minimax-openai` provider that improve MiniMax-M3 tool-call reliability and cost observability on the OpenAI-compatible API path.

## Background

Debug analysis of MiniMax-M3 sessions revealed two distinct failure modes and a cost-visibility gap:

1. **Control-character crash:** M3 emits raw `\t`, `\n`, `\r` inside tool-call argument JSON (e.g., tab-indented code in `edit` calls). The streaming driver's `JSON.parse` throws, leaving arguments as `{}`. Silent data loss.
2. **Nested JSON generation failure:** M3 cannot generate deeply nested JSON with union types (`anyOf`) in tool-call arguments. Arrays of objects collapse to `[{}]`. This is a model-level limitation confirmed across both the Anthropic and OpenAI API paths.
3. **Cache opacity:** MiniMax's OpenAI endpoint supports passive prefix caching ($0.12/M vs $0.60/M input), but there is no visibility into whether cache hits are actually occurring.

## Enhancements

### 1. JSON Repair in Streaming

Intercept tool-call argument accumulation and repair control-character-induced parse failures.

### 2. Collapsed-Argument Detection

Detect when M3 generates empty nested objects and emit a diagnostic text note so the model stops retrying.

### 3. Cache Verification Logging

Log cache hit/miss statistics from the API response for cost observability.

### 4. Tool Result Ordering

Reorder tool results in the request payload to match the order of the preceding assistant's tool calls, preventing MiniMax 400 errors on parallel tool calls.

## Architecture

### File layout

```
src/
  index.ts                           # (unchanged)
  providers/minimax-openai.ts        # Updated: compose pipeline, pre-request transform
  core/
    clean-stream.ts                  # (unchanged) Thinking merge + <think> stripping
    think-scanner.ts                 # (unchanged) Incremental <think> tag parser
    harden-tool-calls.ts             # NEW: JSON repair + collapsed-arg detection + cache logging
    normalize-tool-results.ts        # NEW: reorder tool results pre-request
```

### Pipeline composition

```typescript
// In minimax-openai.ts streamSimple():
const ctx = normalizeToolResults(context); // pre-request
const base = driver.streamSimple(model, ctx, options);
return cleanStream(hardenToolCalls(base)); // post-response
```

Event flow: `MiniMax API -> base stream -> hardenToolCalls -> cleanStream -> Pi`

- `hardenToolCalls` runs first (inner): repairs tool args, detects collapsed args, logs cache stats.
- `cleanStream` runs second (outer): merges thinking blocks, strips `<think>` from text.

This order is intentional: `hardenToolCalls` needs to see tool call events before `cleanStream` rearranges content indices.

## Module: `hardenToolCalls`

### Signature

```typescript
function hardenToolCalls(
  base: AssistantMessageEventStream,
): AssistantMessageEventStream;
```

Takes a base stream, returns a wrapped stream. Same pattern as `cleanStream`.

### JSON Repair

**Trigger:** `toolcall_end` event where `toolCall.arguments` is empty (`Object.keys(args).length === 0`).

**Mechanism:**

- During `toolcall_delta` events, accumulate raw argument string fragments in a `Map<contentIndex, string>`.
- At `toolcall_end`, check if `toolCall.arguments` is empty/malformed.
- If so, attempt `parseJsonWithRepair` from `@earendil-works/pi-ai` on the accumulated raw string. This escapes unescaped control characters (`\t` -> `\\t`, `\n` -> `\\n`, etc.) before parsing.
- If repair succeeds, replace the tool call's arguments with the repaired parse.
- If repair also fails, pass through the original (the tool validator will catch it).
- If `parseJsonWithRepair` is not available, implement a minimal fallback: regex-escape `[\x00-\x1f]` characters that aren't already escaped, then `JSON.parse`.

**Passthrough:** If `toolCall.arguments` is already non-empty and well-formed, no repair is attempted. No double-escaping risk.

### Collapsed-Argument Detection

**Trigger:** `toolcall_end` event, AFTER JSON repair (so we only flag genuine generation failures, not parse crashes).

**Detection heuristic:** Walk the parsed arguments object. If any array contains objects where every property value is `undefined` or missing (i.e., the object is `{}`), flag it as collapsed.

**Action on detection:**

1. Log to stderr: `[minimax-openai] collapsed args detected for tool "${toolName}"`
2. Emit a synthetic text block after the `toolcall_end` event:
   - `text_start` -> `text_delta` -> `text_end` sequence containing:
   ```
   [Note: Tool "${toolName}" received empty nested arguments -- this is a known
   MiniMax-M3 limitation with complex JSON schemas. Do not retry this tool call.]
   ```
3. The tool call itself passes through unchanged. The tool's own schema validator handles the actual error response.

**Why synthetic text:** The warning appears in the assistant message, visible to both the user (in UI) and the model (in context for the next turn). This stops the retry loop after 1-2 attempts instead of 12+, because the model gets explicit guidance that retrying won't help.

**False positive avoidance:** Only flag arrays containing objects where ALL required fields are absent. An object with at least one populated field is not collapsed.

### Cache Verification Logging

**Trigger:** `done` event.

**Mechanism:**

- Read `message.usage.cacheRead` from the done event.
- If `cacheRead > 0`: log `[minimax-openai] cache hit: ${cacheRead} tokens cached`
- If `cacheRead === 0` and `message.usage.input > 1000`: log `[minimax-openai] cache miss: ${input} input tokens, 0 cached`
- Pure logging via `console.error` (Node.js stderr), no stream modification.

### Event passthrough

All events not mentioned above pass through unchanged. The wrapper is transparent for: `start`, `thinking_*`, `text_*`, `error`. For tool calls: `toolcall_start` and `toolcall_delta` pass through immediately (streaming UX preserved), only `toolcall_end` may trigger repair/detection.

## Module: `normalizeToolResults`

### Signature

```typescript
function normalizeToolResults(context: Context): Context;
```

Takes Pi's `Context` object, returns a new one with tool results reordered. Does not mutate the input.

### Mechanism

1. Walk through the context messages.
2. For each assistant message containing multiple tool calls, record the tool call IDs in order: `[id_A, id_B, id_C]`.
3. Find the corresponding user message(s) containing tool results for those IDs.
4. If the tool result order doesn't match the tool call order, create a new user message with results reordered to match.
5. Return the modified context.

### Edge cases

- **Single tool call per turn:** No reordering needed. Skip.
- **Missing tool results:** Some tool calls might not have results (e.g., aborted). Leave gaps as-is.
- **Tool results split across multiple user messages:** Collect all results referencing tool call IDs from the same assistant turn, reorder as a group.
- **No assistant message preceding results:** Pass through unchanged.

### Performance

Linear scan over messages, O(n) where n is the number of messages. No concern for long sessions.

## Testing

### `tests/core/harden-tool-calls.test.ts`

| Test                       | Input                                                                    | Expected                                              |
| -------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| JSON repair: control chars | `toolcall_delta` with raw `\t`/`\n` in arg string                        | `toolcall_end` has repaired arguments                 |
| Repair passthrough         | Valid tool call arguments                                                | Arguments unchanged, no double-escaping               |
| Collapsed-arg detection    | `toolcall_end` with `{"questions":[{}]}`                                 | Synthetic text block emitted with warning             |
| No false positive          | `toolcall_end` with `{"questions":[{"type":"single-choice","id":"q1"}]}` | No warning emitted                                    |
| Cache hit logging          | `done` with `usage.cacheRead > 0`                                        | Log contains "cache hit"                              |
| Cache miss logging         | `done` with `usage.cacheRead === 0`, `input > 1000`                      | Log contains "cache miss"                             |
| Event passthrough          | Full stream with all event types                                         | Non-tool events pass through, content indices correct |

### `tests/core/normalize-tool-results.test.ts`

| Test             | Input                                      | Expected                         |
| ---------------- | ------------------------------------------ | -------------------------------- |
| Reorder          | Assistant `[A, B, C]`, results `[C, A, B]` | Results reordered to `[A, B, C]` |
| Already ordered  | Results match tool call order              | No modification                  |
| Single tool call | One tool call per turn                     | Pass through unchanged           |
| No mutation      | Any input                                  | Input context not mutated        |

### Test utilities

Build mock `AssistantMessageEventStream` from arrays of events. Check existing test infrastructure in `tests/` for patterns before creating new helpers.

### Not tested

- Integration with live MiniMax API (requires credentials).
- `cleanStream` behavior (already tested, unchanged).
- Pi's tool executor or session state management (outside scope).

## Decisions

| Decision              | Choice                    | Rationale                                                                                     |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| API path              | OpenAI only               | Anthropic path has separate issues (fake markup). Passive caching is automatic.               |
| Architecture          | Focused split             | `cleanStream` unchanged. New `hardenToolCalls` wrapper + `normalizeToolResults` function.     |
| Collapsed-arg action  | Log + diagnostic text     | Stops retry loop by giving model explicit guidance. Non-destructive.                          |
| Cache strategy        | Verification logging only | Passive caching is automatic on MiniMax's OpenAI endpoint. No markers to inject.              |
| Schema simplification | Deferred                  | Model-level limitation. High complexity, medium-high risk. Should improve with model updates. |

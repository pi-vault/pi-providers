# MiniMax-M3 OpenAI Provider

## Problem

Pi's built-in `minimax` and `minimax-cn` providers route MiniMax-M3 through the Anthropic-compatible endpoint (`/anthropic/v1/messages`). This endpoint has two failure modes:

1. **Fake tool calls as text.** MiniMax-M3 sometimes emits tool-call markup as plain text instead of structured `tool_use` events. Pi correctly ignores text-based tool calls, resulting in no-op turns where the agent does nothing.

2. **Thinking leakage.** MiniMax-M3 emits `</think>` and `<think>...</think>` content in visible `type: "text"` blocks, even when it also returns proper structured thinking blocks.

These failures are protocol-level: the Anthropic-compatible endpoint on MiniMax's side sometimes fails to emit structured SSE events. The OpenAI-compatible endpoint (`/v1/chat/completions`) does not exhibit the fake-tool-call failure, but it does duplicate reasoning content (once in `reasoning_content` fields and again inline as `<think>` tags in `content`).

## Solution

Register new providers (`minimax-openai`, `minimax-openai-cn`) that route MiniMax-M3 to the OpenAI-compatible endpoint and clean the stream of duplicate/leaked thinking content.

## Scope

- MiniMax-M3 only. M2.x models remain on the built-in Anthropic providers.
- Two providers: global (`api.minimax.io`) and China (`api.minimaxi.com`).
- Stream-level cleaning: merged thinking blocks, stripped `<think>` tags, tool calls pass through unchanged.

## Architecture

```
User selects minimax-openai / MiniMax-M3
        |
        v
pi.registerProvider("minimax-openai", { streamSimple })
        |
        v
streamSimple(model, context, options)
        |
        +---> getApiProvider("openai-completions").streamSimple(...)
        |       -> raw OpenAI SSE stream from https://api.minimax.io/v1
        |
        +---> cleanStream(baseStream)
                -> merged thinking blocks
                -> stripped <think> tags from text
                -> tool calls pass through unchanged
                -> AssistantMessageEventStream (output to Pi)
```

The extension uses `getApiProvider("openai-completions")` from `@earendil-works/pi-ai/compat` to obtain the built-in OpenAI completions driver. It overrides the model's `api` field to `"openai-completions"` when passing to the driver, so Pi's native OpenAI stream parser handles the raw SSE parsing, tool call extraction, and usage reporting. The custom `streamSimple` only adds the cleaning layer on top.

## File Structure

```
src/
  index.ts                         Extension entry: registers providers
  providers/
    minimax-openai.ts              Provider factory + model config
  core/
    clean-stream.ts                Stream rewriting logic
    think-scanner.ts               <think> tag incremental scanner
  shared/
    types.ts                       Internal type definitions

tests/
  index.test.ts                    Extension registration smoke test
  core/
    clean-stream.test.ts           Stream event rewriting tests
    think-scanner.test.ts          ThinkScanner unit tests
  providers/
    minimax-openai.test.ts         Provider config tests
```

## Components

### ThinkScanner (`src/core/think-scanner.ts`)

Incremental parser that splits a text stream into visible text and `<think>...</think>` inner content.

Responsibilities:

- Accept streaming text chunks via `feed(chunk)`, return `{ text, think }` split.
- Buffer partial tag suffixes across chunk boundaries (e.g., `<thi` at end of one chunk, `nk>` at start of next).
- `flush()` at end-of-block to emit any buffered content.
- Handle unterminated `<think>` (content stays in thinking).

Interface:

```ts
class ThinkScanner {
  feed(chunk: string): { text: string; think: string };
  flush(): { text: string; think: string };
}
```

### cleanStream (`src/core/clean-stream.ts`)

Takes a base `AssistantMessageEventStream` from the OpenAI driver and returns a new stream with cleaned output.

Behavior:

- **Thinking merging:** All `thinking_start`/`thinking_delta`/`thinking_end` events from the base stream are collapsed into a single thinking block. When the driver re-streams the same reasoning (due to field alternation between `reasoning_content` and `reasoning`), only the genuinely new suffix is emitted.
- **`<think>` stripping:** Text deltas are fed through `ThinkScanner`. Extracted `<think>` content is either dropped (if structured thinking blocks exist from the driver) or re-routed into the thinking block (if no structured thinking was received).
- **Text trimming:** Leading whitespace on visible text is trimmed. Text blocks that would be entirely empty (pure `<think>` content) are suppressed.
- **Tool call pass-through:** `toolcall_start`, `toolcall_delta`, `toolcall_end` events pass through with content index remapping.
- **Metadata sync:** Usage, stopReason, responseId, and other top-level `AssistantMessage` fields are synced from the base stream's partial messages.
- **Error handling:** Exceptions in the async processing loop emit an error event and end the stream gracefully.

### makeProvider (`src/providers/minimax-openai.ts`)

Factory function that registers a single MiniMax-M3 provider with Pi.

```ts
function makeProvider(
  pi: ExtensionAPI,
  name: string,
  baseUrl: string,
  apiKey: string,
  displayName: string,
): void;
```

Calls `pi.registerProvider(name, config)` with:

- `baseUrl`: OpenAI-compatible endpoint
- `apiKey`: env var reference (`$MINIMAX_API_KEY` or `$MINIMAX_CN_API_KEY`)
- `streamSimple`: custom handler that delegates to `openai-completions` driver + `cleanStream`
- `models`: single M3 model entry

### Extension entry (`src/index.ts`)

```ts
export default function createExtension(pi: ExtensionAPI): void {
  makeProvider(
    pi,
    "minimax-openai",
    "https://api.minimax.io/v1",
    "$MINIMAX_API_KEY",
    "MiniMax (OpenAI)",
  );
  makeProvider(
    pi,
    "minimax-openai-cn",
    "https://api.minimaxi.com/v1",
    "$MINIMAX_CN_API_KEY",
    "MiniMax CN (OpenAI)",
  );
}
```

## Model Configuration

```ts
{
  id: "MiniMax-M3",
  name: "MiniMax-M3",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 512_000,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
  },
}
```

Cost reflects MiniMax-M3 pricing on the OpenAI-compatible endpoint (per million tokens, USD). `cacheWrite: 0` because MiniMax-M3 uses passive caching (no explicit cache-control writes).

## Dependencies

Runtime (peer):

- `@earendil-works/pi-ai` — for `getApiProvider`, `createAssistantMessageEventStream`, types
- `@earendil-works/pi-coding-agent` — for `ExtensionAPI`

Dev:

- Same packages pinned for typecheck
- `vitest` for testing

No new dependencies required. The extension uses only what's already declared in `package.json`.

## Error Handling

- `getApiProvider("openai-completions")` returning `undefined` throws immediately. This indicates Pi's core failed to load and is unrecoverable.
- Base stream errors (`type: "error"` events) propagate through `cleanStream` unchanged.
- Unhandled exceptions in the async stream-processing loop are caught, emit an `error` event with the exception message, and end the output stream.

## Testing Strategy

### ThinkScanner (unit)

- Plain text with no tags passes through unchanged
- Simple `<think>content</think>` extracts content to `think`, removes from `text`
- Tag split across two chunks: `<thi` + `nk>content</think>`
- Multiple `<think>` blocks in one chunk
- Unterminated `<think>` (flush routes remainder to `think`)
- Empty input returns empty strings
- Nested angle brackets inside `<think>` (not real tags)

### cleanStream (integration)

- Thinking blocks from driver merge into one output thinking block
- Duplicate re-streamed reasoning prefix is suppressed (only new suffix emitted)
- `<think>` in text alongside structured thinking is dropped
- `<think>` in text with NO structured thinking is re-routed to thinking block
- Text-only stream passes through (with leading whitespace trimmed)
- Tool call events pass through with correct index remapping
- `done` event carries cleaned final message
- Base stream error propagates correctly
- Exception in processing emits graceful error event

### Provider registration (unit)

- `makeProvider` calls `pi.registerProvider` with expected name, baseUrl, apiKey, models
- `streamSimple` in the config calls `getApiProvider` and wraps with `cleanStream`

### Extension entry (smoke)

- `createExtension` with mock `ExtensionAPI` registers both providers without throwing

## Retirement Criteria

This extension becomes unnecessary when Pi ships MiniMax-M3 on `openai-completions` with built-in thinking deduplication. At that point, switch to the built-in `minimax / MiniMax-M3` via `/model` and uninstall this extension.

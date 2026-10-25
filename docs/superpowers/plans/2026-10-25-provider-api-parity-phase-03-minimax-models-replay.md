# Phase 3 — Direct MiniMax models and reasoning replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship static M3/M3.1 direct providers with correct pricing, output fields, effort controls, and tool-round-trip reasoning.

**Architecture:** Retain the current extension registrations and Pi transports. Change local TypeSafe validation, refresh Command Code's existing catalog module, extract direct MiniMax metadata for reuse, and add a provider-scoped availability callback using Pi's storage/publication lifecycle.

**Tech Stack:** TypeScript ESM, Pi AI/coding-agent `^0.87.1`, TypeBox, Vitest, native fetch/AbortSignal, pnpm, Biome.

**Spec:** [Provider API Parity Specification](../specs/2026-10-25-provider-api-parity-design.md). Read the relevant subsystem section before each phase.

## Global Constraints

- Preserve provider IDs `minimax-openai`, `minimax-openai-cn`, and `command-code`, and tool name `typesafe_decide`.
- Preserve existing credential names, precedence, and login behavior.
- Keep MiniMax on OpenAI Chat Completions and preserve the custom stream-hardening pipeline.
- Keep the current dependencies, Node requirement `>=24.15.0`, and Pi development baseline `^0.87.1`.
- Leave StepFun behavior and registrations unchanged.
- Use mocked HTTP and frozen fixtures in automated tests; credentials and paid inference are not required for acceptance.
- Update README and an Unreleased changelog entry within each behavior phase; preserve historical release entries.
- Release numbering, publishing, and dependency upgrades are outside this work.

## Review Focus

- Criteria-only/null TypeSafe inputs must survive schema validation and serialization; test in phase 1.
- An oversized direct request must never become an oversized gateway fallback; test in phase 1.
- New paid Command Code aliases must not inherit retired free prices or guessed routes; test in phase 2.
- MiniMax reasoning must survive the actual second-turn wire request, including whitespace and multiple tools; test in phase 3.
- Empty, stale, regional, cancelled, or rejected MiniMax publications must not resurrect models or replace valid state; test in phase 4.


**Parent:** [Provider API Parity Implementation Plan](2026-10-25-provider-api-parity.md)  
**Source phase:** 03  
**Parent SHA-256 at extraction:** `84f3e0a8688e63eafebe530318a8c5bc50d3bdb04811c7e383a88ff1e69e22f2`

The phase section below is copied verbatim from the parent. Read the linked spec and inherited constraints; execute only this phase. Track progress here and leave the parent unchanged.

---

## Phase 3 — Direct MiniMax models and reasoning replay

**Phase goal:** Ship static M3/M3.1 direct providers with correct pricing, output fields, effort controls, and tool-round-trip reasoning.

**Prerequisites:** Existing baseline only; phase 2's Command Code updates do not supply direct-provider metadata.  
**Usable result:** Both direct variants can run M3 or Flash before discovery exists, and an existing saved M3 conversation can continue tool use.  
**Spec:** Section 3 and Global constraints.

### Task 3: Update direct models and verify real-driver replay

**Files:**

- Modify: `src/providers/minimax-openai.ts`, `src/providers/minimax-openai/clean-stream.ts`
- Create: `src/providers/minimax-openai/models.ts`, `src/providers/minimax-openai/prepare-thinking-replay.ts`
- Test: `tests/providers/minimax-openai.test.ts`, `tests/providers/minimax-openai/clean-stream.test.ts`
- Create: `tests/providers/minimax-openai/prepare-thinking-replay.test.ts`, `tests/providers/minimax-openai/wire-replay.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: `registerMiniMax(pi: ExtensionAPI): void`, `normalizeToolResults<TContext extends Context>(context: TContext): TContext`, and the existing stream wrappers.
- Produces: `MINIMAX_MODELS: readonly ProviderModelConfig[]` from `models.ts`, containing Flash first and M3 second; clone the definitions when a mutable registration array is required.
- Produces: `prepareThinkingReplay<TContext extends Context>(context: TContext, model: Model<Api>): TContext` from `prepare-thinking-replay.ts`; returns an immutable same-model replay view and preserves the input's context type.
- Retains: `cleanStream(base: AssistantMessageEventStream): AssistantMessageEventStream` and existing external registration/stream signatures.

- [ ] **Step 1: Add failing registration, pricing, and effort tests.** Replace direct-model expectations with these values for both regions; assert neither M2.7 ID is present and region-specific keys/bases remain unchanged.

```ts
expect(config.models.map((model) => model.id)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
expect(flash).toMatchObject({
  input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 524_288,
  cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
  compat: { supportsReasoningEffort: true, maxTokensField: "max_completion_tokens" },
});
expect(m3.cost).toMatchObject({
  input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0,
  tiers: [{ inputTokensAbove: 512_000, input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 }],
});
```

Pin Flash's exact effort map to off/minimal null and the five identity levels. Capture real-driver requests for each supported level and omitted effort: assert `max_completion_tokens` is sent, `max_tokens` is absent, no `thinking: disabled` or effort `none` is sent, and omitted effort stays omitted. Use Pi's cost calculation to assert the M3 rate selection at 512,000 and 512,001 uncached input tokens with cache/output held at zero.

- [ ] **Step 2: Add failing cleanup/history and second-turn wire tests.** In helper tests, assert an unsigned same-model thinking block `" first \n"` becomes a text block `"<think> first \n</think>"`; original block order, tool IDs, and source context remain unchanged. Native signed thinking stays signed, and foreign provider/model history is untouched.

In cleanup tests, stream native chunks with leading/trailing whitespace and `thinkingSignature: "reasoning_content"`; assert the final thinking equals the concatenation exactly. Keep inline-duplicate suppression and interleaved tool/text boundaries covered.

In `wire-replay.test.ts`, use the installed real OpenAI API driver (not the existing mocked-driver module), mocked SSE fetch responses, and two provider `streamSimple` calls. Feed the first call's terminal message and two deliberately reversed tool results into the second call. Assert:

```ts
expect(secondBody.messages.find((message) => message.role === "assistant").reasoning_content)
  .toBe(" first \nsecond ");
expect(secondBody.messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id))
  .toEqual(["tool-a", "tool-b"]);
expect(originalContext).toEqual(originalContextSnapshot);
```

Add a separate legacy M3 replay request expecting ordered `<think>` blocks in assistant `content` and preserved tool calls. Assert caller `onPayload`/`onResponse` hooks each run once and caller replacement payloads are respected. Cover image input, aborted streams, usage/finish events, empty-argument repair, and leaked-markup errors through the existing pipeline tests; add a wire assertion where driver serialization matters.

- [ ] **Step 3: Run focused tests and establish the expected failures.**

Run: `pnpm test -- tests/providers/minimax-openai.test.ts tests/providers/minimax-openai`  
Expected: failures expose absent Flash definitions, incorrect caps/pricing, missing helper/replay content, or altered native reasoning whitespace. Existing hardening tests remain part of this focused run.

- [ ] **Step 4: Implement the complete static-provider behavior.** Extract curated definitions to `models.ts` with the exact metadata, pricing tier, output field, and effort map above. Remove direct M2.7 definitions. Keep M3 automatic thinking and existing key/base registrations. Compose `prepareThinkingReplay(normalizeToolResults(context), model)` before calling the OpenAI driver with the builtin API tag; forward options and preserve wrappers.

Implement immutable legacy conversion only for matching provider/model OpenAI-compatible history; wrap unsigned thinking at its original position, preserve native signed blocks, and leave cross-model conversion to Pi. Adjust cleanup to retain reasoning whitespace/signatures and concatenate arriving fragments without separators, while preserving visible-text cleanup and duplicate suppression. Keep all changes necessary for static Flash inference in this phase; do not defer replay correctness to discovery.

- [ ] **Step 5: Document and verify the usable static providers.** Replace current direct model tables/quickstart with Flash and M3, documented standard/tiered pricing, supported effort levels, and output caps. Explain M2.7 removal from direct providers only; retain historical changelog entries. Add an Unreleased MiniMax entry. Run the focused command, `pnpm check`, and `pnpm pack:dry-run`. Expected: all pass, new helper/model source files are packaged, and the actual second-turn bodies preserve reasoning/tools.

- [ ] **Step 6: Review and commit the atomic phase.**

```sh
git add src/providers/minimax-openai.ts src/providers/minimax-openai/models.ts src/providers/minimax-openai/prepare-thinking-replay.ts src/providers/minimax-openai/clean-stream.ts tests/providers/minimax-openai.test.ts tests/providers/minimax-openai README.md CHANGELOG.md
git commit -m "feat: update MiniMax models and preserve reasoning replay"
```

**Phase acceptance:** Both static direct providers are usable independently of discovery; supported effort/cost/output settings and same-model reasoning/tool replay are proven through the real serializer.

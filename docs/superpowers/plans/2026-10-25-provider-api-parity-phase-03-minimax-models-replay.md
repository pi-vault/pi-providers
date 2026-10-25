# Phase 3 — Direct MiniMax models and reasoning replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation requires a separate user request.

**Goal:** Ship static M3/M3.1 direct providers with current standard pricing, output fields, Flash effort controls, and verified tool-round-trip reasoning.

**Architecture:** Extract curated direct-model definitions, prepare unsigned same-model history before Pi serialization, and correct native reasoning handling in the existing cleanup wrapper. Retain both regional registrations, the builtin OpenAI driver, tool-result normalization, and the hardening pipeline. Runtime availability discovery remains phase 4.

**Tech Stack:** TypeScript ESM, Pi AI/coding-agent `^0.87.1`, Vitest, native fetch/AbortSignal, pnpm, Biome; Node `>=24.15.0`. No new dependencies.

**Spec:** [Provider API Parity Specification](../specs/2026-10-25-provider-api-parity-design.md), section 3 and Global constraints.

**Parent:** [Provider API Parity Implementation Plan](2026-10-25-provider-api-parity.md). This revision supersedes the original phase-3 extract for execution. Leave the approved specification, frozen parent, and other phase plans unchanged.

## Global Constraints

- Preserve provider IDs `minimax-openai`, `minimax-openai-cn`, and `command-code`, and tool name `typesafe_decide`.
- Preserve existing credential names, precedence, and login behavior.
- Keep MiniMax on OpenAI Chat Completions and preserve the custom stream-hardening pipeline.
- Keep the current dependencies, Node requirement `>=24.15.0`, and Pi development baseline `^0.87.1`.
- Leave StepFun behavior and registrations unchanged.
- Use mocked HTTP and frozen fixtures in automated tests; credentials and paid inference are not required for acceptance.
- Update README and an Unreleased changelog entry within each behavior phase; preserve historical release entries.
- Release numbering, publishing, and dependency upgrades are outside this work.

## Readiness review — 2026-10-25

**Verdict:** The original extract needed revision. This revised plan is ready to implement within the approved scope. A fresh builder check found nothing important left unanswered, including reused text/thinking indexes, late signatures, the replay predicate, installed Pi test contracts, and the phase-4 model export. Implementation and its acceptance checks remain outstanding.

Baseline: clean tree at `9c2efe73980828581915210de392a7957a9f98a8`, branch `20261025-provider-api-parity-phase-03-minimax-models-replay`. Phases 1 and 2 are merged. Node `v24.21.0`, pnpm `12.9.1`, installed Pi AI/coding-agent `0.87.1`. `pnpm check` exited 0: 10 files / 243 tests; Biome reported 13 existing `noNonNullAssertion` warnings in MiniMax source/tests. `pnpm pack:dry-run` exited 0. The focused command `pnpm exec vitest run tests/providers/minimax-openai.test.ts tests/providers/minimax-openai` passed 5 files / 68 tests.

1. The copied architecture mixed TypeSafe, Command Code, and discovery into this phase. Only direct static models and replay belong here. Phase 2's gateway definitions retain their gateway ID, `max_tokens`, and 32,768 default output cap.
2. A mocked real-driver two-turn probe reproduced signature loss: SSE reasoning `" first \n"` + `"second "`, followed by two tools, becomes unsigned `"first \nsecond"`. The next assistant wire message has tools but no `reasoning_content`. Cleanup closes its segment on tool start; Pi emits `thinking_end` later, when that segment is already closed, so assigning only `segment.signature` then never updates the output block. Capture the signature before a boundary closes the segment.
3. Existing cleanup test `deduplicates re-streamed reasoning prefix` expects `ABC` + `ABCDEF` to become `ABCDEF`. Native SSE fields are deltas: the correct result is `ABCABCDEF`. Replace that expectation; retain duplicate inline `<think>` suppression separately.
4. Pi retains signed history only when provider, model, and API match. Registration uses a custom API ID, but driver-produced history uses `openai-completions`. Specify the legacy predicate against that builtin tag, rather than comparing history with the registered model's custom `api`.
5. Flash's map excludes unsupported picker levels; it does not validate arbitrary raw options. This extension exposes `streamSimple` with `{ reasoning }`, and Pi clamps `minimal` to `low`. Omission stays omitted. The candidate map/compatibility passed seven successful real-driver mocked-SSE probes: five supported efforts, omission, and `minimal`→`low`, with `max_completion_tokens: 524288`, no `max_tokens`, and no `thinking` field.
6. Use `pnpm exec vitest run ...` for focused checks. `pnpm test -- ...` previously ran the whole suite during phase-2 review.
7. A second real-driver probe reproduced interleaving loss: reasoning `A` → text `one` → reasoning `B` → text `two` becomes `[thinking A, text onetwo, thinking B]`. Pi reuses base text/thinking indexes; cleanup must split resumed visible-text runs as well as thinking runs to preserve arrival order.

### Evidence and precedence

Checked 2026-10-25. Approved scope comes from the spec, executable contracts from installed Pi, and direct rates/wire parameters from official MiniMax docs.

- Reference checkout `/Users/lanh/Developer/pi-packages/pi`, SHA `d5b3de22d0e24a3e9c38a9410d3329b099717283`: inspect `packages/ai/src/api/openai-completions.ts`, `packages/ai/src/api/transform-messages.ts`, `packages/ai/src/api/simple-options.ts`, `packages/ai/src/models.ts`, and `packages/coding-agent/src/core/extensions/types.ts`. Compile/test against this repo's installed `node_modules/@earendil-works/pi-ai/dist/` and coding-agent types. The checkout drops foreign thinking while installed `0.87.1` converts readable foreign thinking to text. Leave this policy to Pi; do not copy newer code or upgrade dependencies.
- [MiniMax guides](https://platform.minimax.io/docs/guides/) and [API overview](https://platform.minimax.io/docs/api-reference/api-overview): the overview lists both multimodal models with 1,000,000 total context tokens. The guides landing page can lag; it does not override explicit API contracts or the approved direct M2.7 removal.
- [OpenAI compatibility](https://platform.minimax.io/docs/api-reference/text-openai-api): Flash supports low/medium/high/xhigh/max, defaults to max when omitted, and rejects disabled thinking/`none`. M3 automatic thinking stays the integration default; add no disable control.
- [Create Chat Completion](https://platform.minimax.io/docs/api-reference/text-chat-openai): both models support `max_completion_tokens` up to 524,288; `max_tokens` is deprecated. This is the output ceiling within total context, not a guarantee of that output with a full prompt. Retain Pi's context-room clamp.
- [Standard pricing](https://platform.minimax.io/docs/pricing/overview): Flash 0.15/0.60/0.015; M3 0.30/1.20/0.06 at ≤512,000 input tokens, doubling above. Units: USD per 1M input/output/cache-read tokens. Cache-write estimates stay zero; add no priority controls.
- [Tool use](https://platform.minimax.io/docs/guides/text-m3-function-call): replay the full assistant response, including reasoning/tools. Tool calls may omit reasoning; do not manufacture thinking for those turns.
- [Command Code Provider API](https://commandcode.ai/docs/provider) and [GOAT](https://commandcode.ai/docs/plans/goat): gateway access, aliases, and subscription billing are separate from direct MiniMax definitions/credentials. Preserve merged phase 2 and calculate no entitlements.
- [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart): Jev is a typed-decision System One tool. Phase 1 owns that integration; add no SDK, tool-contract, or fallback changes here.

## Review Focus

- Reasoning followed by text/tools must retain signatures even when Pi delays `thinking_end` until stream completion.
- Whitespace-only fragments, repeated prefixes, and contiguous thinking blocks must concatenate exactly; interleaved output keeps separate ordered segments.
- Saved unsigned M3 thinking must reach the real second request without mutating saved context or rewriting foreign history.
- Flash omission and `minimal` clamping must use Pi's real simple driver; M3 keeps automatic thinking without an effort field.
- Both regions retain URL/key/model identity, successful usage/finish events, cancellation, and tool/markup hardening.

## File map and interfaces

| File | Responsibility |
| --- | --- |
| `src/providers/minimax-openai/models.ts` (new) | Curated direct metadata for this phase and later discovery |
| `src/providers/minimax-openai/prepare-thinking-replay.ts` (new) | Immutable same-provider/model legacy replay view |
| `src/providers/minimax-openai.ts` | Regional registrations and context preparation before the driver |
| `src/providers/minimax-openai/clean-stream.ts` | Exact native reasoning/signatures and ordered events |
| `tests/providers/minimax-openai.test.ts` | Registration, metadata, mocked-driver composition |
| `tests/providers/minimax-openai/clean-stream.test.ts` | Cleanup events, late signatures, boundaries, inline suppression |
| `tests/providers/minimax-openai/prepare-thinking-replay.test.ts` (new) | Conversion predicate/order and immutability |
| `tests/providers/minimax-openai/wire-replay.test.ts` (new) | Real-driver SSE, request controls, replay bodies, hooks |
| `README.md`, `CHANGELOG.md` | Current direct documentation and Unreleased entries |

Retain `registerMiniMax(pi: ExtensionAPI): void`, `cleanStream(base: AssistantMessageEventStream): AssistantMessageEventStream`, and public stream signatures. Leave `hardenToolCalls`, `normalizeToolResults`, and `ThinkScanner` implementations unchanged.

Export `MINIMAX_MODELS: readonly ProviderModelConfig[]` from `models.ts`, Flash first, M3 second. Give each registration a mutable deep clone (`structuredClone([...MINIMAX_MODELS])`); do not share nested input/cost/compat objects across regions or mutate curated definitions. Include dated official source comments.

Export `prepareThinkingReplay<TContext extends Context>(context: TContext, model: Model<Api>): TContext`. Only convert assistant messages with provider equal to `model.provider`, model equal to `model.id`, and API exactly `openai-completions`. This fixed API predicate accounts for the target's custom registration tag. Replace each unsigned, non-redacted thinking block at its original position with a text block whose `text` is `<think>${block.thinking}</think>`, including empty/whitespace-only strings. Preserve signed/redacted blocks, other content, metadata, and foreign provider/model/API history. Copy only changed context/messages/content; preserve the exact input context type, including `TranscriptContext`. Reapplying is a no-op.

Compose `prepareThinkingReplay(normalizeToolResults(context), model)` in `streamSimple`; delegate with `{ ...model, api: "openai-completions" }`, caller options unchanged, and retain `cleanStream(hardenToolCalls(base))`. Add no payload rewrite hook, stored-transcript mutation, transport, refresh callback, timer, or cache.

### Exact curated contract

| Field | Flash | M3 |
| --- | --- | --- |
| `id` / `name` | `MiniMax-M3.1-Flash` | `MiniMax-M3` |
| `reasoning` | `true` | `true` |
| `input` | `["text", "image"]` | `["text", "image"]` |
| `contextWindow` | `1_000_000` | `1_000_000` |
| `maxTokens` | `524_288` | `524_288` |
| `cost` input/output/cacheRead/cacheWrite | `0.15 / 0.6 / 0.015 / 0` | `0.3 / 1.2 / 0.06 / 0` |
| `cost.tiers` | absent | `[{ inputTokensAbove: 512_000, input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 }]` |
| `compat.supportsReasoningEffort` | `true` | `false` |
| `thinkingLevelMap` | exact map below | absent |

Both compat objects retain `supportsStore: false`, `supportsDeveloperRole: false`, and use `maxTokensField: "max_completion_tokens"`. Do not enable `requiresThinkingAsText`. Flash's exact map:

```ts
{ off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }
```

Global remains `https://api.minimax.io/v1` / `$MINIMAX_API_KEY`; China remains `https://api.minimaxi.com/v1` / `$MINIMAX_CN_API_KEY`. Remove both direct M2.7 entries. Command Code model records remain independent.

---

## Task 3A: Static models and real-driver request controls

**Files:** Create `models.ts`; modify `minimax-openai.ts` and `tests/providers/minimax-openai.test.ts`; create `tests/providers/minimax-openai/wire-replay.test.ts`.

**Interfaces:** Consume current registrations and installed Pi driver; produce `MINIMAX_MODELS` and the curated contract above for later discovery.

- [ ] **Step 1: Add failing registration and pricing tests.**

Replace the old three-model expectation. For both regions, assert exact IDs `["MiniMax-M3.1-Flash", "MiniMax-M3"]`, all contract fields/rates/tiers, unchanged URLs/key expressions/custom API IDs, and absent M2.7. Build a full Flash `Model<Api>` from registration metadata; assert `getSupportedThinkingLevels(flash)` equals `["low", "medium", "high", "xhigh", "max"]`. Verify nested registration objects are independent.

Use installed Pi `calculateCost(model, usage)` with fresh usages. For M3, input-only cost at 512,000 is `0.1536`; at 512,001 it is `0.3072006` (`toBeCloseTo`). Also use `input: 500_000, cacheRead: 12_001, output: 10, cacheWrite: 0`: Pi counts cached input toward the threshold; assert request-wide input/cacheRead/output rates `0.6 / 0.12 / 2.4` per million, rather than applying a tier only to excess tokens.

- [ ] **Step 2: Add successful real-driver request tests.**

Keep the new wire-test file free of Pi module mocks, especially the sibling registration test's compat mock. Capture registrations through a typed fake `ExtensionAPI`; construct full models from config plus regional `provider`, custom `api`, and `baseUrl`. Use Pi's `normalizeContext` for branded transcripts and leading system/tool declarations.

Inject `fetch: typeof globalThis.fetch`; capture with `new Request(input, init)`. Always pass a fake explicit `apiKey` and `maxRetries: 0`. Return status 200, `content-type: text/event-stream`, native reasoning/text chunks, a stop finish chunk, a final `choices: []` usage chunk, then `[DONE]`. Consume `.result()` and assert terminal success so a parser failure cannot masquerade as valid request evidence.

For both regions, run Flash `streamSimple` with `{ reasoning: level }` for all five supported levels, no `maxTokens` override. Assert regional `/chat/completions` URL, fake Bearer key, exact model ID, `max_completion_tokens: 524288`, absent `max_tokens`, matching `reasoning_effort`, `stream_options.include_usage: true`, and no disabled thinking/`none`. Omission must omit effort; `minimal` must become `low`. Do not pass literal `off` to `SimpleStreamOptions.reasoning` or add raw-driver validation.

For M3, omitted reasoning and requested `high` both send no effort/disable field. Include explicit `maxTokens: 1234` and assert that wire limit. Include image input and assert a data-URL `image_url` part. For usage `{ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 3 } }`, assert input `8`, cacheRead `3`, output `7`, totalTokens `18`, and terminal `stop`.

- [ ] **Step 3: Run tests and confirm behavioral failures.**

Run `pnpm exec vitest run tests/providers/minimax-openai.test.ts tests/providers/minimax-openai/wire-replay.test.ts`. Expected: failures on missing Flash, old M3 pricing/cap, and output field. Invalid SSE or test setup/type errors do not establish the desired red state.

- [ ] **Step 4: Implement static definitions and registration clones.**

Implement `models.ts`, replacing inline definitions with the curated export and per-registration deep clones. Retain driver invocation and wrappers at this step. No gateway or transport changes.

- [ ] **Step 5: Verify static settings.**

Run the step-3 command and `pnpm typecheck`. Expected: pass for metadata, pricing thresholds, regional requests, efforts, image input, usage, and finish status. Replay defects remain Task 3B.

## Task 3B: Exact cleanup and immutable legacy replay

**Files:** Create `prepare-thinking-replay.ts` and its test; modify registration, cleanup source/tests, and wire tests. Update README/changelog before shipping the phase.

**Interfaces:** Consume Task 3A models/harness; produce `prepareThinkingReplay` and corrected cleanup through the existing stream signature.

- [ ] **Step 1: Add failing legacy helper tests.**

Test `wraps unsigned same-model OpenAI thinking at its original position`: text, thinking `" first \n"`, tool call, more thinking; assert exact `<think> first \n</think>` text, order, tool IDs, and metadata. Cover empty/whitespace-only unsigned blocks, signed/redacted blocks, both regions, wrong model/region, and non-Completions history. Use a target model with custom API ID to prove the builtin-history predicate. Assert immutability, idempotence, unchanged-reference return for no-op, and preservation of normalized `TranscriptContext` without a cast in the stream call.

- [ ] **Step 2: Add failing native cleanup event tests.**

Add `keeps native whitespace and late signatures after tool start`, `concatenates native repeated prefixes without deduplication`, and `keeps signed reasoning segments around text and tools`. Model the actual driver: a signed base block supplies start/deltas; text/tool starts precede its eventual `thinking_end`. Reasoning can resume at the same base `contentIndex` without another `thinking_start`.

Assert `" first \n"` + `"second "` equals `" first \nsecond "` in deltas, end content, and terminal blocks, with `thinkingSignature: "reasoning_content"`. Include whitespace-only fragments and contiguous native blocks. Replace the old prefix-dedup test: `ABC` + `ABCDEF` must become `ABCABCDEF`. Assert thinking/text/tool/thinking order and signatures on every native segment despite delayed ends. Add `splits resumed text at a reused base index`: reasoning A → text one → reasoning B → text two must emit four ordered blocks, with balanced starts/ends and no delta referring to an ended output run. Keep inline `<think>` duplicate suppression and visible-text whitespace cleanup.

- [ ] **Step 3: Add failing real two-turn wire tests.**

Parameterize native replay over both models and regions. First SSE response emits `reasoning_content` fragments `" first \n"` and `"second "`, two indexed tool calls (`tool-a`, `tool-b`), `finish_reason: "tool_calls"`, usage, and `[DONE]`. Feed its actual terminal message and reversed tool results into the second extension `streamSimple` call; never manufacture a signed replacement message. Snapshot source context before dispatch. Assert:

```ts
expect(first.stopReason).toBe("toolUse");
expect(first.content[0]).toMatchObject({
  type: "thinking", thinking: " first \nsecond ", thinkingSignature: "reasoning_content",
});
expect(secondAssistant.reasoning_content).toBe(" first \nsecond ");
expect(secondTools.map((message) => message.tool_call_id)).toEqual(["tool-a", "tool-b"]);
expect(secondAssistant.tool_calls.map((call) => call.id)).toEqual(["tool-a", "tool-b"]);
expect(originalContext).toEqual(originalContextSnapshot);
```

Add `replays legacy M3 thinking as ordered think-tagged assistant content`: multiple unsigned blocks mixed with text/two tools; assert exact concatenated assistant content, preserved IDs, sorted results, and unchanged stored blocks. Add a successful tool-only turn without reasoning; replay must invent no thinking.

Add an interleaved native fixture (thinking → text → more thinking → more text, reusing base indexes). Assert four exact ordered terminal segments and replay in Pi's native reasoning field. Installed Pi serializes separate nonempty signed blocks with `join("\n")` and concatenates visible text; pin those wire behaviors explicitly. The no-invented-separator requirement applies to contiguous fragments merged by cleanup; do not flatten interleaved transcript blocks or add payload rewriting.

Attach `onPayload`/`onResponse` spies to the second call; each runs once. Return a replacement object with a distinctive field from `onPayload`; the captured body must respect it. Hooks see the builtin driver model identity. Verify headers/custom fetch/signal forwarding and an aborted real-driver case ending `aborted`, with no successful done event. Existing pipeline tests own leaked markup, empty-argument repair, and collapsed-argument diagnostics; retain them in the focused run.

- [ ] **Step 4: Run focused tests and establish failures.**

Run `pnpm exec vitest run tests/providers/minimax-openai.test.ts tests/providers/minimax-openai`. Expected: failures expose trimming, late signature loss, missing second-turn/legacy reasoning, and native prefix deletion. A missing helper may be the first helper-test failure; once a typed stub exists, confirm the intended behavioral assertions fail before implementing it.

- [ ] **Step 5: Implement replay preparation and native cleanup.**

Implement the helper/composition from Interfaces. Append native thinking deltas exactly once in arrival order, without trimming, prefix normalization, or prefix deduplication. Remove obsolete `baseThinkingAccs`. Read the signature from the base block at start/delta time and assign it to the output block before text/tool boundaries close the segment; do not rely solely on delayed `thinking_end` or a detached `segment.signature`. Preserve balanced segment events, inline suppression, visible-text cleanup, tool-index remapping, terminal metadata/errors, and existing scanner/hardening/normalization implementations.

Close the active visible-text run before emitting a new native thinking/tool run. If later visible deltas reuse the base text index, allocate a new output text block/index while retaining that base stream's scanner state. End each emitted text run once; a delayed base `text_end` must not end an already closed run again. This is cleanup state management, not a scanner rewrite.

- [ ] **Step 6: Verify full direct behavior.**

Run the step-4 command and `pnpm typecheck`. Expected: pass for two-turn native/legacy bodies, late signatures, same-index resumed reasoning, repeated prefixes, tool-only history, hooks/replacements, cancellation, and existing hardening. No paid endpoint is required.

- [ ] **Step 7: Document and run phase acceptance.**

Update current README introduction, direct quickstart/model table, image support, and technical notes with Flash first, M3, exact standard/tiered rates, 524,288 ceiling, and five Flash efforts. Explain omitted effort uses upstream max; simple-path `minimal` clamps to `low`; M3 remains automatic. Explain direct-only M2.7 removal and saved-session reasoning replay; do not promise discovery or rewrite historical release sections. Append MiniMax entries to existing Unreleased changelog sections.

Run `pnpm check`, `pnpm pack:dry-run`, and `git diff --check`. Expected: exit 0, tests pass, no new warnings. Baseline warnings do not mandate unrelated cleanup. Inspect packaging for both new source modules; tests/plans stay excluded. Verify only file-map paths changed, with no spec/parent/other-phase/dependency edits.

- [ ] **Step 8: Review the phase diff and commit when authorized.**

```sh
git add src/providers/minimax-openai.ts src/providers/minimax-openai/models.ts src/providers/minimax-openai/prepare-thinking-replay.ts src/providers/minimax-openai/clean-stream.ts tests/providers/minimax-openai.test.ts tests/providers/minimax-openai/clean-stream.test.ts tests/providers/minimax-openai/prepare-thinking-replay.test.ts tests/providers/minimax-openai/wire-replay.test.ts README.md CHANGELOG.md
git commit -m "feat: update MiniMax models and preserve reasoning replay"
```

**Phase acceptance:** Both static regional providers support Flash/M3 independently of discovery. Metadata, efforts/output settings, request-wide cost tiers, exact native reasoning/signatures, and immutable legacy tool replay are proven through the installed real serializer and successful mocked SSE. Existing hardening and unrelated providers/tools remain covered. Authenticated regional/paid behavior is an optional smoke test, not a claimed result of mocked acceptance.

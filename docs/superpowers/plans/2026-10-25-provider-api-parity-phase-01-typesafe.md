# Phase 1 — TypeSafe text contract and gateway limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation requires a separate user request.

**Goal:** Accept the approved TypeSafe text-question shapes and prevent either Command Code dispatch path from sending more than 100 questions.

**Architecture:** Keep the existing `typesafe_decide` registration, direct HTTP client, result format, and fallback state machine. Update its parameter types, TypeBox schema, and runtime normalization together, then add a local limit check at each gateway boundary. All production changes stay in the existing tool module.

**Tech Stack:** TypeScript ESM, Pi AI/coding-agent `^0.87.1`, TypeBox, Vitest, native fetch/AbortSignal, pnpm, Biome; Node `>=24.15.0`.

**Spec:** [Provider API Parity Specification](../specs/2026-10-25-provider-api-parity-design.md), section 1 and Global constraints.

**Parent:** [Provider API Parity Implementation Plan](2026-10-25-provider-api-parity.md). This revised phase plan supersedes the original phase-1 extract for execution. The approved specification remains authoritative; leave the frozen parent, specification, and other phase plans unchanged.

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

- Omitted and explicit-null instructions must retain their distinct wire shapes after Pi validation and local normalization; covered in Task 1.
- Noul without non-null instructions requires an own, non-null `true` or `false` description; inherited properties and unknown outcome keys do not satisfy it; covered in Task 1.
- Single-option Choice and single-level Score must pass response validation, while 255 options and 10 levels remain usable; covered in Task 1.
- A 101-question direct success remains allowed, but neither initial gateway routing nor retryable fallback may dispatch that batch; covered in Task 2.
- Cancellation takes precedence over limit errors, blocked fallback retains the sanitized direct cause, and no blocked route resolves Command Code credentials; covered in Task 2.

## Readiness review and evidence — 2026-10-25

The original plan needed revision before execution. Its behavior goals match the approved specification, but these checks and decisions needed to be made concrete:

1. The harness calls `tool.execute` directly. Schema-property assertions alone do not test Pi's validation, conversion, and cloning before execution. Add host-path tests using the installed Pi helper, alongside raw-schema and runtime tests.
2. The guard instruction allowed placement anywhere before fetch. Specify placement before Command Code credential resolution, after cancellation, and define oversized-fallback error precedence.
3. Noul's conditional rule, obsolete null-outcome rejection tests, positive upper boundaries, and single-option Choice answers need explicit acceptance assertions.
4. `pnpm test -- tests/tools/typesafe-decide.test.ts` ran all 9 files / 187 tests here. Use `pnpm exec vitest run tests/tools/typesafe-decide.test.ts` for the focused check; it ran 1 file / 42 baseline tests.
5. The copied architecture and review focus included phases 2–4. This revision is restricted to TypeSafe.

Repository baseline: clean tree at `6bc845e488971f6e79aec1775a6db15221d26cf9`, branch `20261025-provider-api-parity-phase-01-typesafe`; Node `v24.21.0`, pnpm `12.9.1`. `pnpm check` exited 0 with 9 files / 187 tests passing, including 42 TypeSafe tests. Biome reported 13 existing `noNonNullAssertion` warnings in MiniMax source/tests; do not expand this phase to fix them. `pnpm pack:dry-run` exited 0 and excluded plans/tests.

The reference checkout `/Users/lanh/Developer/pi-packages/pi` is at `d5b3de22d` and reports Pi AI `1.4.0`; this repository installs `0.87.1`. Read `packages/agent/src/agent-loop.ts` and `packages/ai/src/utils/validation.ts` there for the host flow, but compile and test against this repository's installed packages. Both expose `validateToolArguments`; the installed root export was verified. No dependency upgrade is needed.

Pi clones arguments and applies conversion before execution. A read-only probe against installed `0.87.1` showed raw-schema rejection of Score `["Low", null]`, but host conversion produced `["Low", ""]`. This is existing host behavior. Test invalid inputs against the raw schema and direct execution; test that already-valid new shapes survive the real host path unchanged. This phase does not replace Pi's coercion policy or claim to reject original values the host has already converted.

### Reference decisions

- [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart): retain a state plus named typed questions; add no SDK or chat model.
- [TypeSafe OpenAPI](https://api.typesafe.ai/openapi.json), `ChoiceQuestion` and `ScoreQuestion`: use minimum 1 and maxima 255/10; Score entries exclude null. Introductory prose is less precise, and the [advanced structure guide](https://docs.typesafe.ai/primitives/advanced) lists nullable Score entries contrary to the wire schema. Follow the schema and approved spec.
- [Noul reference](https://docs.typesafe.ai/sdk/javascript/api/interfaces/NoulQuestion) and [Python question reference](https://docs.typesafe.ai/sdk/python/api/types/questions): outcome descriptions provide the question when instructions are omitted/null. OpenAPI exposes nullability but does not encode this semantic condition; enforce it locally as the approved spec requires.
- [TypeSafe models](https://docs.typesafe.ai/models) and [request rules](https://docs.typesafe.ai/api/errors): token/body/depth limits remain upstream checks. Document normal 64K per-request / 32K per-question token budgets; add no estimator, long-context header, compression, or retry policy.
- [Command Code Provider API](https://commandcode.ai/docs/provider), decision-model and ZDR sections: System One uses `typesafe/jev`, accepts up to 100 questions, and has no ZDR-capable upstream. Retain the existing aliases and omit `x-cmd-zdr`.
- [GOAT plan](https://commandcode.ai/docs/plans/goat): API access and account limits do not imply a local subscription checker. Preserve host-resolved Command Code authentication.
- [MiniMax guides](https://platform.minimax.io/docs/guides/) and [API overview](https://platform.minimax.io/docs/api-reference/api-overview): reviewed for overall provider scope; they add no dependency or deliverable to phase 1. Model, transport, replay, and discovery work belongs to the other phase plans.

## File map and implementation boundaries

| File | Responsibility in this phase |
| --- | --- |
| `src/tools/typesafe-decide.ts` | Question types/schema, runtime normalization, tool description, gateway guard and error composition |
| `tests/tools/typesafe-decide.test.ts` | Existing harness plus raw-schema, Pi-host, wire, boundary, and fallback regressions |
| `README.md` | Current TypeSafe Decisions contract, routing limits, fallback/privacy explanation |
| `CHANGELOG.md` | New `## [Unreleased]` entry above released history |

No new source modules, fixtures, dependencies, exports, provider registrations, backend selector, question chunking, image/Box support, or billing calculations. Keep `validateAnswer`, `parseDecision`, `attemptDecision`, and `toResult` behavior unchanged unless a new regression demonstrates a required phase-1 correction.

## Task 1: Align question types, schema, normalization, and documentation

**Files:** Modify all four files in the file map; tests stay in the existing test file.

**Interfaces:**

- Retain `registerTypeSafeDecisionTool(pi: ExtensionAPI): void`, exported `decideParameters`, `DecideParams`, and `DecideDetails`.
- Retain internal `validateQuestion(id: string, raw: unknown): Question` and `validateQuestions(raw: unknown): QuestionMap`.
- Keep `QuestionValue` as the non-null string/object/array description boundary. Set `instructions?: QuestionValue | null` in each question interface; Noul `criteria?: { true?: QuestionValue | null; false?: QuestionValue | null } | null`; Choice `criteria: Record<string, QuestionValue | null>`; Score `criteria: QuestionValue[]`.
- Reuse `createHarness`, `installFetch`, and `callTool`. Add test helper `callValidatedTool(harness: ReturnType<typeof createHarness>, params: unknown, signal?: AbortSignal): ReturnType<typeof callTool>` using `validateToolArguments` from `@earendil-works/pi-ai`, then `callTool` with the returned arguments. Import `Compile` from `typebox/compile` for raw-schema checks and `DecideParams` as a type for assignment checks. No production export of validation internals.

- [ ] **Step 1: Write failing accepted-shape tests through all boundaries.** Add `accepts criteria-only questions through Pi validation` and `preserves explicit null fields through Pi validation`, using matching mocked answers and these fixtures:

```ts
const accepted = {
  criteria_only: { type: "noul", criteria: { true: "Ready to ship" } },
  false_only: { type: "noul", instructions: null, criteria: { false: "Blocked", true: null } },
  null_criteria: { type: "noul", instructions: "Ready?", criteria: null },
  null_outcomes: { type: "noul", instructions: "Ready?", criteria: { true: null, false: null } },
  empty_criteria: { type: "noul", instructions: "Ready?", criteria: {} },
  single_choice: { type: "choice", criteria: { only: null } },
  single_score: { type: "score", instructions: null, criteria: ["Only level"] },
} satisfies DecideParams["questions"];
```

Supply Noul answers `{ type: "noul", noul: 0.5 }`, Choice `{ type: "choice", choice: "only", confidence: 1, probabilities: { only: 1 } }`, and Score `{ type: "score", score: 0, confidence: 1, legend: { "0": "Only level" }, probabilities: { "0": 1 } }`. Use response model `jev-1.14.0` for new direct fixtures and `typesafe/jev` for new gateway fixtures, with integer usage counts. Do not update historical fixtures merely to change version strings.

For each accepted case, require raw `Compile(tool.parameters).Check(params)` to be true, run both direct execution and `callValidatedTool` in fresh harnesses, and compare serialized questions to the input. Repeat with direct credentials present and absent so both endpoints exercise the new shapes. Include omitted and null instructions for Choice and Score, Noul true-only and false-only criteria, and an instructions-only Noul whose criteria remains absent. Retain string/object/array cases from existing structured fixtures, including nested JSON null/number/boolean values.

```ts
expect(Object.hasOwn(sent.questions.criteria_only, "instructions")).toBe(false);
expect(sent.questions.false_only.instructions).toBeNull();
expect(sent.questions.false_only.criteria.true).toBeNull();
expect(sent.questions.null_criteria.criteria).toBeNull();
expect(Object.hasOwn(sent.questions.single_choice, "instructions")).toBe(false);
expect(result.details.answers.single_score).toEqual({
  type: "score", score: 0, confidence: 1,
  legend: { "0": "Only level" }, probabilities: { "0": 1 },
});
expect(result.details.answers.single_choice).toMatchObject({
  choice: "only", probabilities: { only: 1 },
});
```

Add `uses only own Noul outcome keys` and `preserves prototype-sensitive IDs through Pi validation`: construct own `__proto__`, `constructor`, and `toString` question/Choice-option IDs using `JSON.parse` or `Object.create(null)`; assert own keys in the POST, answers, and serialized tool content. An inherited `true` description must not make an otherwise invalid question valid. Do not introduce special keys using an object literal's `__proto__` syntax.

- [ ] **Step 2: Write rejection and cardinality regressions.** Update `ParametersSchema` as needed; identify union variants by their `type` literal rather than array position. Assert Choice schema bounds `1/255` and Score bounds `1/10`.

| Test / input family | Assertions |
| --- | --- |
| `requires a non-null Noul description without instructions` | With omitted/null instructions, raw schema and runtime reject omitted criteria, null, `{}`, `{ true: null }`, `{ false: null }`, and `{ true: null, false: null }` |
| `rejects unknown Noul outcome keys` | Reject `criteria: { maybe: "Ready" }` even with valid instructions; raw schema and runtime agree |
| `accepts exact Choice and Score boundaries` | Choice counts 1/255 and Score counts 1/10: valid raw schema, one successful POST, matching complete answers |
| `rejects out-of-range criteria before credentials` | Choice counts 0/256 and Score counts 0/11: invalid raw schema; runtime rejects with `/between 1 and 255/` or `/between 1 and 10/` |
| `rejects null Score levels and scalar descriptions` | Null Score entry, numeric/boolean instruction, numeric/boolean outcome or Choice description: raw schema false and direct execution rejects |
| `retains JSON validation before network` | Preserve invalid state/nested-undefined tests; add NaN/Infinity and cycles in state/descriptions to direct-execution checks |

For runtime rejections assert `await expect(callTool(harness, params)).rejects.toThrow(...)`, `expect(fetchMock).not.toHaveBeenCalled()`, and `expect(harness.getApiKeyForProvider).not.toHaveBeenCalled()`. Raw schemas need not enforce finite/cycle-free nested JSON; the existing runtime check owns that boundary. Do not route deliberately non-JSON values through Pi cloning to test this module's validator.

Replace the old one-option/one-level rejection fixtures with empty criteria. Remove the obsolete rejection of Noul `{ true: null }` when instructions are valid. Keep empty strings, objects, and arrays accepted as non-null descriptions; add no semantic non-emptiness heuristic. Explicit `undefined` on an own instructions/criteria/outcome property remains invalid at runtime, distinct from an omitted property.

- [ ] **Step 3: Confirm the intended red tests.**

Run: `pnpm exec vitest run tests/tools/typesafe-decide.test.ts` and `pnpm typecheck`.

Expected: new tests fail on required instructions, old minimums, null outcomes, or missing conditional schema validation; the `satisfies DecideParams` fixture also exposes required-instructions type errors. Diagnose unexpected baseline failures before production edits.

- [ ] **Step 4: Implement schema/runtime parity in the existing module.** Apply the interface changes and minimum constants `1`. Reuse a nullable question-value schema for instructions, Choice descriptions, and Noul descriptions. Keep Score entries on the non-null schema.

Define the Noul base object with optional nullable instructions and optional nullable criteria. Restrict the criteria object's keys to `true`/`false` using `additionalProperties: false`. Compose an `anyOf` condition requiring either non-null instructions, a non-null own `criteria.true`, or a non-null own `criteria.false`; each condition must require the property it checks, including enclosing `criteria`. This is an OR: valid instructions permit absent/null/empty/all-null criteria. Keep the condition inside Noul and common criteria validation in every branch. The exact TypeBox composition is an implementer choice; its behavior is pinned by the tests.

Mirror the rule in `validateQuestion`. Check own-property presence before reading optional fields; validate supplied values without treating explicit `undefined` as omission. Build normalized questions with instructions/criteria only when supplied, preserving explicit null. Retain own-key maps, finite/cycle-free JSON validation, and handling of unrelated extra question fields. Do not use truthiness to determine presence or manufacture empty strings.

Update the tool description to state optional/null instructions, conditional Noul requirements, and ranges `1-255` / `1-10`. Keep answer validation, token usage, and zero-cost reporting unchanged.

- [ ] **Step 5: Document and verify the contract deliverable.** Update README TypeSafe Decisions with the new bounds and a compact criteria-only/explicit-null example. Explain Noul's condition and non-null Score levels. Add `## [Unreleased]` / `### Fixed` above released changelog history. Run `pnpm exec vitest run tests/tools/typesafe-decide.test.ts` and `pnpm typecheck`; expect both to pass. Hold the phase commit until Task 2 is complete.

## Task 2: Enforce the gateway limit without changing direct routing

**Files:** Modify the same four files; reuse Task 1's harness and question types.

**Interfaces:**

- Add internal `assertCommandCodeQuestionLimit(questions: QuestionMap): void`, counting own IDs with `Object.getOwnPropertyNames`; maximum `100`.
- Guard error message: `Command Code System One accepts at most 100 questions per request; received ${count}`.
- Keep `failureMessage(backendLabel: string, attempt: Failure): string`, classification, endpoint/model constants, and result format.
- For retryable direct failure plus oversized fallback, combine `failureMessage("TypeSafe", direct)`, `"; "`, and the guard's message in a new Error. Catch only the synchronous guard error to compose this; do not reclassify cancellation or credential errors.

- [ ] **Step 1: Write failing gateway boundary/routing tests.** Construct `count` independent Noul questions and exactly matching answers for every ID. Assert POST destinations and credential lookups:

| Test | Expected observations |
| --- | --- |
| `allows 101 direct questions` | Direct key, 101 questions: exactly one direct POST and direct result; no Command Code key lookup |
| `allows 100 initial gateway questions` | No direct key, 100 questions: exactly one gateway POST and gateway result |
| `allows 100 fallback questions` | Direct 503, 100 questions: one direct POST, one gateway POST, gateway result |
| `rejects 101 initial gateway questions before credentials` | No direct key, 101 questions: limit error, zero fetches, no Command Code lookup; same with present/absent gateway key and blank host/environment direct keys |
| `retains direct failure when 101 questions prevent fallback` | Direct 401/403/429/529/500/503, transport exception, controlled timeout, or malformed 200: one direct POST, zero gateway POSTs, no gateway lookup, sanitized combined error; repeat with absent gateway key |
| `keeps oversized terminal direct failures terminal` | Direct 400/404/413/415/422, 101 questions: one direct POST, original status error, no limit text or gateway lookup |

Reuse controlled `AbortSignal.timeout` mocks rather than sleeping ten seconds. Cover response-body and fetch timeouts. Put secret markers in transport messages and response bodies and assert their absence from combined errors.

```ts
expect(requests.map((request) => request.url)).toEqual([DIRECT_URL]);
expect(harness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
expect(error.message).toMatch(/TypeSafe.*503/); // Adapt to each failure category.
expect(error.message).toContain("at most 100 questions per request; received 101");
expect(error.message).not.toContain(DIRECT_KEY);
expect(error.message).not.toContain(FALLBACK_KEY);
expect(error.message).not.toContain("secret-upstream-marker");
```

- [ ] **Step 2: Write cancellation-order regressions.** Add `cancels oversized calls before the gateway guard` for pre-aborted 101-question requests and abort during TypeSafe credential resolution: cancellation error without `/100/`, zero fetches, no gateway lookup. Add `cancels oversized direct failures before fallback credentials`: abort while direct fetch/body completes or rejects; require one direct POST, cancellation only, no gateway lookup. Retain the in-limit cancellation-during-gateway-credentials test, proving the post-await check still runs. Keep existing missing-credentials behavior for requests of 100 or fewer.

- [ ] **Step 3: Confirm the intended red tests.**

Run: `pnpm exec vitest run tests/tools/typesafe-decide.test.ts`.

Expected: new oversized cases fail because existing code resolves gateway credentials and/or sends a gateway POST. Task 1 tests stay green.

- [ ] **Step 4: Add the guard at both gateway paths.**

1. Initial gateway branch (`!directKey`): existing `throwIfCancelled(signal, "Command Code")`, then the guard, then `await fallbackKey()`. Keep post-resolution cancellation and missing-key checks before dispatch.
2. Retryable direct attempt: keep direct success/cancelled/terminal exits first; existing cancellation check, then guard with combined-error handling, then resolve fallback key. Preserve post-resolution cancellation and absent-key behavior for allowed-size requests.

Do not place a count guard before choosing the backend or in `validateQuestions`: direct calls have no fixed local question cap. Keep `attemptDecision`, its ten-second per-attempt timeout, and one-fallback maximum. Authentication failures remain eligible for backend failover. No splitting, SDK retries/backoff, danger-zone headers, or `x-cmd-zdr`.

- [ ] **Step 5: Document the gateway boundary.** Add direct token budgets versus the 100-question gateway maximum in README TypeSafe Decisions. Explain that an oversized failed direct call reports its direct cause plus the gateway restriction and is never split. Make 401/403 failover/privacy behavior explicit without suggesting direct credentials disable fallback or imply ZDR. Retain billing/usage explanations and historical release notes. Add the gateway fix to Task 1's Unreleased section.

- [ ] **Step 6: Verify the complete phase and review the diff.**

```sh
pnpm exec vitest run tests/tools/typesafe-decide.test.ts
pnpm check
pnpm pack:dry-run
git diff --check
git diff --stat
git diff -- src/tools/typesafe-decide.ts tests/tools/typesafe-decide.test.ts README.md CHANGELOG.md
```

Expected: focused run includes only TypeSafe and all new cases; full suite/typecheck/format pass; no new lint warnings beyond the recorded 13; packaging includes the tool and excludes plans/tests. Only the four implementation files change in product scope. Every Review Focus item has a named regression. Report actual test counts, not a permanently pinned 187.

- [ ] **Step 7: Commit the atomic phase after implementation is requested and verified.** Stage explicit paths, including this plan only if its revision is not already committed. Inspect the staged stat; exclude unrelated work.

```sh
git add src/tools/typesafe-decide.ts tests/tools/typesafe-decide.test.ts README.md CHANGELOG.md docs/superpowers/plans/2026-10-25-provider-api-parity-phase-01-typesafe.md
git diff --cached --stat
git commit -m "fix: align TypeSafe questions and gateway request limits"
```

## Phase acceptance and handoff

The independent builder review on 2026-10-25 returned “nothing important left.” This revised plan is ready for implementation. Product acceptance requires the tasks' checks, valid shapes preserved through Pi validation and serialization, exact gateway boundaries on both paths, and existing result/auth/fallback behavior retained. Paid inference is optional and is not required or performed during planning. No implementation step above is complete merely because this plan was revised.

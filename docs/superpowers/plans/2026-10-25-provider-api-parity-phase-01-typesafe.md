# Phase 1 — TypeSafe text contract and gateway limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship compatible text-question validation and prevent invalid oversized gateway attempts.

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
**Source phase:** 01  
**Parent SHA-256 at extraction:** `84f3e0a8688e63eafebe530318a8c5bc50d3bdb04811c7e383a88ff1e69e22f2`

The phase section below is copied verbatim from the parent. Read the linked spec and inherited constraints; execute only this phase. Track progress here and leave the parent unchanged.

---

## Phase 1 — TypeSafe text contract and gateway limit

**Phase goal:** Ship compatible text-question validation and prevent invalid oversized gateway attempts.

**Prerequisites:** Existing baseline only; independent of other providers.  
**Usable result:** Existing TypeSafe calls still work, newly documented question shapes work, and a large direct call does not silently split or overrun gateway limits.  
**Spec:** Sections 1 and Global constraints.

### Task 1: Update the question contract and backend boundary

**Files:**

- Modify: `src/tools/typesafe-decide.ts`
- Test: `tests/tools/typesafe-decide.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: `registerTypeSafeDecisionTool(pi: ExtensionAPI): void`, existing `createHarness`, `installFetch`, `callTool` test helpers, and current fallback state machine.
- Produces: unchanged tool name/result; broader `DecideParams` through `decideParameters`; internal `assertCommandCodeQuestionLimit(questions: QuestionMap): void` with maximum `100`.
- Retains: `validateQuestion(id: string, raw: unknown): Question`, `validateQuestions(raw: unknown): QuestionMap`, direct/gateway aliases, and existing response checks.

- [ ] **Step 1: Add failing contract and wire tests.** Extend the existing table-driven tests with the following exact assertions; update obsolete tests that expect one-option Choice or one-level Score to fail.

```ts
// In the existing harness, provide a matching answer for each accepted question.
expect(choiceSchema.minProperties).toBe(1);
expect(choiceSchema.maxProperties).toBe(255);
expect(scoreSchema.minItems).toBe(1);
expect(scoreSchema.maxItems).toBe(10);
expect(Object.hasOwn(sent.questions.criteria_only, "instructions")).toBe(false);
expect(sent.questions.null_instructions.instructions).toBeNull();
expect(sent.questions.null_criteria.criteria).toBeNull();
expect(result.details.answers.single_score).toMatchObject({
  type: "score", score: 0, probabilities: { "0": 1 },
});
```

Add cases named `accepts criteria-only questions`, `preserves explicit null instructions and Noul criteria`, `requires a non-null Noul description without instructions`, and `preserves prototype-sensitive IDs in criteria-only questions`. Accept Noul null outcome values when another outcome or instructions supplies meaning. Reject Noul with no instructions and missing/null/empty/all-null criteria; reject Choice counts 0/256, Score counts 0/11, null Score levels, and existing invalid JSON inputs before fetching. Ensure host-level schema validation accepts every runtime-valid new shape.

Add `allows 101 direct questions`, `allows 100 gateway questions`, `rejects 101 gateway questions before fetching`, and `retains direct failure when 101 questions prevent fallback`. Build matching Noul responses for all requested IDs. Assert direct success uses exactly one direct POST, gateway rejection uses zero gateway POSTs, and a retryable direct failure produces exactly one direct POST plus a sanitized message matching `/100/` and the original failure category. Include cancellation before the guard and before fallback credential resolution.

- [ ] **Step 2: Run the focused tests and verify the intended failures.**

Run: `pnpm test -- tests/tools/typesafe-decide.test.ts`  
Expected: new cases fail on required instructions, minimum-two constraints, or an unwanted gateway POST; baseline failures must not be hidden.

- [ ] **Step 3: Implement schema/runtime parity in the existing tool module.** Make question instructions optional and nullable, Noul criteria/outcomes nullable, and the two minimum counts `1`. Preserve own-property presence during normalization; avoid adding an instructions key when it was absent. Require a non-null Noul outcome only when instructions are absent/null. Keep Score levels non-null. Keep TypeBox constraints and runtime checks aligned, expressing Noul's conditional requirement with schema composition and the same runtime rule. Keep prototype-safe construction.

Add `assertCommandCodeQuestionLimit` at both existing gateway dispatch paths after cancellation checks and before gateway fetch. On a failed direct attempt followed by a blocked oversized fallback, combine the sanitized direct failure with the gateway-limit explanation. Preserve the existing fallthrough statuses, ten-second timeout, credential precedence, answer validation, and absence of ZDR headers; do not introduce request chunking or SDK retries.

- [ ] **Step 4: Document the usable result.** Update current README question bounds, optional/null examples, direct token budgets versus gateway question count, and existing authentication-failure fallback/privacy behavior. Add an Unreleased TypeSafe entry. Retain historical examples that still satisfy the broader contract and the existing cost-reporting explanation.

- [ ] **Step 5: Verify the complete phase.**

Run: `pnpm test -- tests/tools/typesafe-decide.test.ts`  
Run: `pnpm check`  
Run: `pnpm pack:dry-run`  
Expected: all pass; the gateway never receives 101 questions; other provider registrations are unchanged.

- [ ] **Step 6: Review and commit the atomic phase.**

```sh
git add src/tools/typesafe-decide.ts tests/tools/typesafe-decide.test.ts README.md CHANGELOG.md
git commit -m "fix: align TypeSafe questions and gateway request limits"
```

**Phase acceptance:** All new question shapes work through the registered tool, invalid requests fail before network use, and the existing backend/fallback contract remains intact.

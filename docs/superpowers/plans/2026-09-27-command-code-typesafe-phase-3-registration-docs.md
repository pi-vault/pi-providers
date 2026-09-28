# Phase 3: Extension Registration and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the existing `typesafe_decide` tool and document its configuration, routing, billing, and privacy behavior alongside the refreshed Command Code provider.

**Architecture:** Keep provider registration unchanged and add the already-tested `registerTypeSafeDecisionTool` call after it. Document TypeSafe as a non-chat Pi tool that prefers direct TypeSafe access and uses Command Code as its only fallback; do not register another `typesafe` provider because current Pi already owns that provider ID.

**Tech Stack:** TypeScript, Pi `ExtensionAPI`, Vitest, Markdown, npm package metadata.

**Spec:** `docs/superpowers/plans/2026-09-27-command-code-typesafe-integration.md`, reconciled with the Phase 2 implementation, `/Users/lanh/Developer/pi-packages/pi` at commit `2b0a123de`, and the live TypeSafe and Command Code documentation on 2026-09-27.

## Global Constraints

- Phase 2 already exports `registerTypeSafeDecisionTool(pi: ExtensionAPI): void` from `src/tools/typesafe-decide.ts`; do not rename, duplicate, or reimplement it.
- Preserve the provider registration order: `command-code`, `minimax-openai`, `minimax-openai-cn`, then `stepfun-ai`.
- Register no TypeSafe provider or selectable chat model; `typesafe_decide` remains a non-chat tool.
- Add no dependency, SDK, configuration file, or package version change.
- Document the implemented auth order exactly: host-resolved `typesafe` credential, then non-blank `TYPESAFE_API_KEY`, then `command-code` fallback auth.
- Document that direct retryable failures may fall back once, while direct `400`/`422` responses and caller cancellation are terminal.
- Document that `CMD_ZDR=1` is never forwarded to System One because Command Code has no ZDR-capable upstream for `typesafe/jev`.
- Keep volatile prices out of package prose; link to the live Command Code plan/provider pages and explain which account or credit pool is charged.
- Do not change the package version from `0.3.1`.

## Current-State Gate

The branch starts from merged Phase 2 at commit `6828275`. The working tree is clean and the baseline currently passes:

```bash
pnpm check
# Expected: exit 0; 9 test files and 158 tests pass. Biome reports 13 existing noNonNullAssertion warnings.
```

Do not fold unrelated warning cleanup into this phase.

## Review Focus

- A fresh extension load must register exactly one `typesafe_decide` tool while preserving all four existing provider registrations and their order.
- Existing `src/index.ts` tests use partial `ExtensionAPI` doubles; every double must provide `registerTool` once the tool is activated.
- README copy must not imply that Jev appears in the model picker or accepts chat prompts.
- README copy must identify the billed backend from the tool result and state that Command Code fallback consumes plan credits or pay-as-you-go credit.
- README and changelog must not claim ZDR for Jev or leave the old 62-model / 2026-08-29 Command Code snapshot in place.

---

### Task 1: Register the TypeSafe decision tool

**Files:**

- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: `registerTypeSafeDecisionTool(pi: ExtensionAPI): void` from `src/tools/typesafe-decide.ts`.
- Produces: the extension default export registers the existing providers plus one tool named `typesafe_decide` with label `TypeSafe Decide`.

- [ ] **Step 1: Update the extension registration test first**

In `tests/index.test.ts`, add a `registerTool` spy to every partial `ExtensionAPI` double. Extend the first test (and rename it to mention the tool) with these assertions while retaining its existing provider-order assertions:

```typescript
expect(registerTool).toHaveBeenCalledTimes(1);
expect(registerTool.mock.calls[0]?.[0]).toMatchObject({
  name: "typesafe_decide",
  label: "TypeSafe Decide",
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
pnpm vitest run tests/index.test.ts
```

Expected: FAIL because `registerTool` was not called; the existing provider assertions still pass.

- [ ] **Step 3: Wire the existing registration function**

In `src/index.ts`, import `registerTypeSafeDecisionTool` from `./tools/typesafe-decide.ts` and call it after `registerStepFun(pi)`. Do not reorder or edit any provider registration.

- [ ] **Step 4: Run the focused registration and tool tests**

Run:

```bash
pnpm vitest run tests/index.test.ts tests/tools/typesafe-decide.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the activation**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: register typesafe decision tool"
```

### Task 2: Document configuration and package behavior

**Files:**

- Modify: `README.md`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: the implemented `typesafe_decide` request/result contract and the Command Code 82-model catalog from Phases 1–2.
- Produces: durable user-facing setup, usage, billing, privacy, package metadata, and release notes without changing runtime behavior.

- [ ] **Step 1: Update package metadata**

Change `package.json` only as follows:

- Make the description mention the existing model providers and the TypeSafe Jev decision tool.
- Add `typesafe` and `jev` keywords.
- Leave `version`, scripts, dependencies, peer dependencies, and engine requirements unchanged.

- [ ] **Step 2: Update README setup and current provider facts**

Make these exact content changes in `README.md`:

- Update the introduction to distinguish the MiniMax, StepFun, and Command Code model providers from the TypeSafe decision tool.
- Add `TYPESAFE_API_KEY` to Quick Start as the preferred direct credential; retain `CMD_API_KEY` for the Command Code provider and TypeSafe fallback.
- Keep the model-picker instructions provider-only and state separately that `typesafe_decide` is a tool, not a selectable chat model.
- Replace both stale Command Code snapshot claims (`62` models captured `2026-08-29`) with `82` models captured `2026-09-27`.
- Describe endpoint-aware Command Code routing: `/messages` takes precedence, `/chat/completions` is used otherwise, and `/responses`-only records are not exposed because this package does not implement Responses API transport.

- [ ] **Step 3: Add a focused TypeSafe Decisions section to README**

Document the shipped contract without duplicating the full upstream API reference:

- `typesafe_decide` accepts JSON `state` plus one or more named Noul, Choice, or Score questions and returns structured probabilities rather than generated text.
- Link to the TypeSafe quick start for question construction and show one compact request example containing all three question types.
- Explain direct-first routing: configured TypeSafe credentials call `jev-latest`; absent or retryably failing direct access may make one Command Code request to `typesafe/jev`; invalid direct requests (`400`/`422`) and cancellation do not fall back.
- Explain billing visibility: the result's `backend` is `typesafe` or `command-code`; direct calls bill the TypeSafe account, while fallback calls consume the Command Code plan's model-specific credits or pay-as-you-go balance. Link to the live Command Code Provider API and GOAT plan instead of copying mutable rates.
- State plainly that the tool never sends `x-cmd-zdr`, even when `CMD_ZDR=1`, because Command Code documents no ZDR-capable upstream for `typesafe/jev`. Users who require enforced ZDR must not rely on the Command Code fallback.
- Note that the result also includes the concrete response `model`, `answers`, and token `usage`.

- [ ] **Step 4: Add an Unreleased changelog entry**

At the top of `CHANGELOG.md`, add `## [Unreleased]` with:

- `Added`: the non-chat `typesafe_decide` tool, direct TypeSafe access, and single Command Code fallback.
- `Changed`: the bundled Command Code snapshot from 62 to 82 models, endpoint-declared routing, `/responses`-only filtering, and refreshed 2026-09-27 pricing estimates.
- A privacy note in the TypeSafe bullet that System One requests never inherit `CMD_ZDR` because `typesafe/jev` has no ZDR-capable Command Code upstream.

Do not add a release date or change the package version.

- [ ] **Step 5: Format and inspect the documentation diff**

Run:

```bash
pnpm format
git diff --check
git diff -- README.md package.json CHANGELOG.md
```

Expected: formatting and whitespace checks pass; the diff contains only the content above, with no version or dependency changes and no remaining 62-model / 2026-08-29 claims.

- [ ] **Step 6: Commit the documentation**

```bash
git add README.md package.json CHANGELOG.md
git commit -m "docs: document command and typesafe integration"
```

### Task 3: Verify the integrated package

**Files:**

- Verify only; fix only failures introduced by Tasks 1–2.

**Interfaces:**

- Consumes: the activated extension entry point and updated package documentation.
- Produces: evidence that Phase 3 is tested, linted, type-safe, and packageable before Phase 4's final release review.

- [ ] **Step 1: Run the full repository gate**

Run:

```bash
pnpm check
```

Expected: exit 0. Existing Biome `noNonNullAssertion` warnings may remain; no new warning may originate from this phase.

- [ ] **Step 2: Inspect the package dry-run**

Run:

```bash
pnpm pack:dry-run
```

Expected: exit 0; the package includes `src/index.ts`, `src/tools/typesafe-decide.ts`, `README.md`, `CHANGELOG.md`, and `package.json`.

- [ ] **Step 3: Review the complete phase diff**

Run:

```bash
git diff HEAD~2 --check
git diff HEAD~2 -- src/index.ts tests/index.test.ts README.md package.json CHANGELOG.md
```

Confirm exactly one new tool registration, unchanged provider order, no new dependency, no version bump, no credentials, no claim that Jev is a chat model, and no claim that Command Code fallback is ZDR.

## References

- Pi built-in TypeSafe classifier provider and runtime: `/Users/lanh/Developer/pi-packages/pi` at commit `2b0a123de` (classifier support is currently unreleased relative to package version `0.87.1`; this phase keeps the extension tool for released hosts and its richer native response contract).
- Command Code Provider API: https://commandcode.ai/docs/provider
- Command Code GOAT plan: https://commandcode.ai/docs/plans/goat
- TypeSafe quick start: https://docs.typesafe.ai/introduction/quickstart
- TypeSafe API reference: https://docs.typesafe.ai/api

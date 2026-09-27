# Command Code Refresh and TypeSafe Decision Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the Command Code provider and add a TypeSafe Jev decision tool with direct TypeSafe access and automatic Command Code fallback.

**Architecture:** Keep Command Code as a conversational provider using the catalog’s endpoint declarations: Anthropic Messages for `/messages` models and OpenAI Chat Completions for `/chat/completions` models. Add a TypeSafe decision capability that calls TypeSafe directly first and Command Code’s `/systemone` endpoint second.

**Tech Stack:** TypeScript, Pi `ExtensionAPI`, `@earendil-works/pi-ai/compat`, TypeBox, native `fetch`, Vitest, Biome.

**Spec:** Approved brainstorming design in the preceding conversation; all decisions are reproduced below.

## Global Constraints

- Keep Node `>=24.15.0` and existing Pi peer dependencies.
- Do not add an SDK or runtime dependency; use native `fetch` and existing Pi credential/auth APIs.
- Jev must not be registered as a selectable chat model.
- Route Command Code chat models from `supported_endpoints`; keep Chat Completions as the only OpenAI implementation and do not add Responses API support in this change.
- Direct TypeSafe is preferred when configured; Command Code is the sole fallback.
- Never send `x-cmd-zdr` to either System One request.
- Do not bump the package version outside the release workflow.

## Review Focus

- Catalog entries with malformed or unsupported endpoint metadata must retain the cached catalog rather than silently creating unusable models; cover in Command catalog tests.
- Choice and Score questions must enforce their documented cardinalities; cover in TypeSafe tool schema tests.
- Direct TypeSafe `400/422` validation failures must not trigger a second billable request; cover in fallback tests.
- Aborted calls must stop without fallback; cover with an aborted signal test.
- A successful fallback must identify the billing backend and must not leak credentials; cover in result-shape tests.

---

### Task 1: Refresh Command Code catalog metadata and snapshot

The complete Phase 1 contract, exact September 27, 2026 catalog delta, pricing policy, endpoint distribution, and acceptance tests live in [the standalone Phase 1 plan](./2026-09-27-command-code-typesafe-phase-1-catalog.md). That plan is the source of truth for this task.

**Files:**

- Modify: `src/providers/command-code/models.ts`
- Modify: `src/providers/command-code.ts`
- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Extend `CommandCodeCatalogRecord` with `supportedEndpoints: readonly string[]`.
- Route by endpoint metadata, with `/messages` taking precedence when both supported routes appear.
- Skip valid records without `/messages` or `/chat/completions`; reject malformed endpoint metadata and zero-usable catalogs while retaining cached models.

- [ ] **Step 1: Add failing catalog tests** for endpoint-aware routing, unsupported-endpoint filtering, malformed endpoint metadata, the current 82-record snapshot, the 22 current additions, removal of the two expired MiniMax free IDs, and current price entries/free-model exceptions.
- [ ] **Step 2: Run the focused tests** with `pnpm vitest run tests/providers/command-code.test.ts`; confirm the new assertions fail against the prefix-based 62-model implementation.
- [ ] **Step 3: Implement the standalone Phase 1 plan’s endpoint validation, filtering, endpoint-aware conversion, 82-record snapshot, and selected pricing policy.**
- [ ] **Step 4: Run the focused tests** again and confirm all catalog, request-routing, cache-retention, and refresh tests pass.
- [ ] **Step 5: Commit** with `git add src/providers/command-code.ts src/providers/command-code/models.ts tests/providers/command-code.test.ts && git commit -m "feat: refresh command code model catalog"`.

### Task 2: Add the TypeSafe auth provider and decision tool

**Status:** Needs replan before execution. The current `/Users/lanh/Developer/pi-packages/pi` checkout exposes a native TypeSafe classifier provider and System One API; reconcile that upstream interface before creating a duplicate auth-only provider. See the standalone Phase 2 plan.

**Files:**

- Create: `src/providers/typesafe.ts`
- Create: `tests/providers/typesafe.test.ts`

**Interfaces:**

- Export `createTypeSafeProvider(): Provider` as an auth-only provider with ID `typesafe`, base URL `https://api.typesafe.ai/v1`, `TYPESAFE_API_KEY` auth, an empty model list, and no selectable chat API.
- Export `registerTypeSafe(pi: ExtensionAPI): void`.
- Register the tool `typesafe_decide` with `state` as string/object/array and a non-empty `questions` map containing Noul, Choice, or Score questions. Choice criteria must contain 2–255 options; Score criteria must contain 2–10 ordered levels.
- Tool success details must contain `{ backend: "typesafe" | "command-code", model: string, answers: object, usage: object }`.

- [ ] **Step 1: Add failing tests** for TypeSafe request serialization, all three question types, direct success, missing direct key, retryable/auth fallback, no fallback for `400/422`, malformed response fallback, both credentials missing, cancellation/timeout, backend reporting, absence of `x-cmd-zdr`, and `registerTypeSafe` provider/tool registration.
- [ ] **Step 2: Run the new test file** with `pnpm vitest run tests/providers/typesafe.test.ts`; confirm it fails because the provider/tool does not exist.
- [ ] **Step 3: Implement the auth-only provider and tool** using Pi’s model registry for credentials and native `fetch`. Call direct TypeSafe with `jev-latest` at `/systemone`; call Command Code with `typesafe/jev` at `/provider/v1/systemone`. Use a 10-second abortable request per backend. Fall back only for missing credentials, `401/403`, `429`, `529`, `5xx`, timeout, transport, or malformed-success failures; never fall back after cancellation or `400/422` validation failures.
- [ ] **Step 4: Run the new tests** and confirm successful results identify the backend while errors omit secrets.
- [ ] **Step 5: Commit** with `git add src/providers/typesafe.ts tests/providers/typesafe.test.ts && git commit -m "feat: add typesafe decision tool"`.

### Task 3: Register and document the integration

**Files:**

- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Register `registerTypeSafe`** from `src/index.ts`, update package description/keywords, and add README instructions for `TYPESAFE_API_KEY`, `CMD_API_KEY`, fallback order, non-chat usage, backend reporting, and the ZDR limitation.
- [ ] **Step 2: Add an `Unreleased` changelog entry** describing the 82-model Command refresh, endpoint-aware routing, and TypeSafe decision tool. Do not change the version field.
- [ ] **Step 3: Run registration and documentation checks** with the full test suite and formatting/lint checks.
- [ ] **Step 4: Commit** with `git add src/index.ts README.md package.json CHANGELOG.md && git commit -m "docs: document command and typesafe providers"`.

### Task 4: Full verification and package inspection

- [ ] **Step 1: Run `pnpm check`** and fix only failures caused by this plan.
- [ ] **Step 2: Run `pnpm pack:dry-run`** and confirm the new provider, tests-independent runtime files, README, and changelog are included in the package.
- [ ] **Step 3: Review the final diff** for unchanged existing provider behavior, absent credentials in errors, no accidental ZDR header, and no unrequested dependency or version changes.

## References

- [Command Code Provider API](https://commandcode.ai/docs/provider)
- [Command Code GOAT Plan](https://commandcode.ai/docs/plans/goat)
- [TypeSafe Quickstart](https://docs.typesafe.ai/introduction/quickstart)
- [TypeSafe coding-agent guidance](https://docs.typesafe.ai/introduction/coding-agents)
- [TypeSafe API reference](https://docs.typesafe.ai/api)

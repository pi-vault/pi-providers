# Phase 2: TypeSafe Auth Provider and Decision Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Pi tool for TypeSafe Jev decisions with direct TypeSafe access and Command Code fallback.

**Depends on:** Phase 1 is recommended for the current Command catalog, but this module only requires the existing `command-code` provider’s auth registration.

**Usable result:** The exported provider and registration function can be exercised independently through mocked HTTP and Pi extension tests.

**Status:** Needs replan before execution. The current `/Users/lanh/Developer/pi-packages/pi` checkout exposes a native `typesafe` classifier provider and System One API; reconcile that upstream interface before creating a duplicate auth-only provider.

**Files:**

- Create: `src/providers/typesafe.ts`
- Create: `tests/providers/typesafe.test.ts`

**Interfaces:**

- Export `createTypeSafeProvider(): Provider` with ID `typesafe`, base URL `https://api.typesafe.ai/v1`, `TYPESAFE_API_KEY` auth, zero models, and no selectable chat API.
- Export `registerTypeSafe(pi: ExtensionAPI): void`.
- Register `typesafe_decide` with `state` as string/object/array and a non-empty question map.
- Noul accepts optional true/false criteria; Choice accepts 2–255 options; Score accepts 2–10 ordered levels.
- Success details are `{ backend: "typesafe" | "command-code", model: string, answers: object, usage: object }`.

## Steps

- [ ] Add failing tests for request serialization, all three question types, direct success, missing direct key, retryable/auth fallback, no fallback for `400/422`, malformed response fallback, both credentials missing, cancellation/timeout, backend reporting, absent `x-cmd-zdr`, and provider/tool registration.
- [ ] Run `pnpm vitest run tests/providers/typesafe.test.ts` and confirm failure because the module does not exist.
- [ ] Implement the auth-only provider and tool using Pi’s model registry and native `fetch`. Call `https://api.typesafe.ai/v1/systemone` with `jev-latest`; fallback to `https://api.commandcode.ai/provider/v1/systemone` with `typesafe/jev`.
- [ ] Use a 10-second abortable request per backend. Fall back only for missing credentials, `401/403`, `429`, `529`, `5xx`, timeout, transport, or malformed-success failures. Never fall back after cancellation or `400/422` validation failures, and never send `x-cmd-zdr`.
- [ ] Re-run the focused tests and confirm successful results identify the backend while errors omit secrets.
- [ ] Commit with `git add src/providers/typesafe.ts tests/providers/typesafe.test.ts && git commit -m "feat: add typesafe decision tool"`.

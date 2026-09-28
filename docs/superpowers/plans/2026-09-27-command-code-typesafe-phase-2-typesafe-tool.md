# Phase 2: TypeSafe Decision Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `typesafe_decide` Pi tool that calls TypeSafe Jev directly and falls back to Command Code without registering or replacing a TypeSafe provider.

**Architecture:** Keep the tool in one module and use native `fetch` for the TypeSafe-native Noul/Choice/Score contract. Resolve the direct key from Pi’s `typesafe` provider when a host exposes it, then from `TYPESAFE_API_KEY`; resolve fallback auth from the existing `command-code` provider. This avoids duplicating Pi’s built-in TypeSafe classifier provider while preserving fields Pi’s provider-neutral classifier result omits: the concrete response model and token usage.

**Tech Stack:** TypeScript, Pi `ExtensionAPI`, TypeBox, native `fetch`, Vitest.

**Spec:** Approved integration design in `docs/superpowers/plans/2026-09-27-command-code-typesafe-integration.md`, reconciled with Pi commit `a328aa89a` and the live TypeSafe and Command Code API documentation.

## Global Constraints

- Add no provider, SDK, runtime dependency, selectable chat model, or classifier model.
- Add no `createTypeSafeProvider`; a future/current Pi host may already own provider ID `typesafe`.
- Use `POST https://api.typesafe.ai/v1/systemone` with model `jev-latest` first.
- Use `POST https://api.commandcode.ai/provider/v1/systemone` with model `typesafe/jev` only as fallback.
- Never send `x-cmd-zdr`, even when `CMD_ZDR=1`; Command Code documents that Jev has no ZDR-capable upstream.
- Use one 10-second timeout per backend and no internal retries.
- Caller cancellation is terminal. Direct `400` and `422` responses are terminal. Fall back only when direct credentials are absent or direct access fails with `401`, `403`, `429`, `529`, `5xx`, timeout, transport failure, or malformed success data.
- Do not include credentials, authorization headers, or upstream response bodies in tool errors.
- Do not bump the package version.

## Current-State Gate

The repository is **not ready for implementation yet**: `pnpm check` currently fails in existing MiniMax and Command Code code after the dependency update (`TranscriptContext` and `JsonObject` type errors). Repair that baseline in its own change before starting this phase; do not hide those failures inside the TypeSafe commit.

After the baseline repair, record this precondition before Task 1:

```bash
pnpm check
# Expected: exit 0
```

## Why the Existing Plan Changed

- The local Pi checkout has a built-in `typesafe` classifier provider; registering another provider with that ID would replace or duplicate host behavior.
- Pi’s released `ModelRegistry` does not expose classifier execution. The local checkout’s provider-neutral classifier contract also maps Noul to `bool`, restricts state/instructions more than the TypeSafe HTTP API, and drops response `usage` and the concrete response model.
- The tool therefore reuses Pi only for credential resolution and owns the small TypeSafe-native HTTP boundary required by its public contract.

## Review Focus

- Prototype-sensitive question IDs such as `__proto__` must remain ordinary own keys through request and response handling.
- Empty question maps, Choice outside 2–255 options, and Score outside 2–10 levels must fail before any request.
- A caller abort must not become a timeout or trigger Command Code fallback.
- Direct `400/422` must not trigger a second billable request; retryable direct failures may trigger exactly one fallback request.
- Success and failure results must identify the backend without exposing either credential or inheriting `x-cmd-zdr`.

---

### Task 1: Add the TypeSafe-native decision tool

**Files:**

- Create: `src/tools/typesafe-decide.ts`
- Create: `tests/tools/typesafe-decide.test.ts`

**Interfaces:**

- Produces: `registerTypeSafeDecisionTool(pi: ExtensionAPI): void`.
- Registers: `typesafe_decide` with label `TypeSafe Decide`.
- Consumes direct auth in this order: `ctx.modelRegistry.getApiKeyForProvider("typesafe")`, then non-blank `process.env.TYPESAFE_API_KEY`.
- Consumes fallback auth from `ctx.modelRegistry.getApiKeyForProvider("command-code")`.
- Accepts `state` as a JSON string, object, or array and a non-empty question map.
- Accepts TypeSafe-native questions:
  - Noul: `{ type: "noul", instructions, criteria? }`; optional criteria may describe `true` and/or `false`.
  - Choice: `{ type: "choice", instructions, criteria }`; criteria has 2–255 named options.
  - Score: `{ type: "score", instructions, criteria }`; criteria has 2–10 ordered levels.
- `instructions` and criteria descriptions accept JSON values supported by TypeSafe, not only strings.
- Success details are `{ backend: "typesafe" | "command-code", model: string, answers: object, usage: { input_tokens: number, output_tokens: number } }`.
- Success model-facing content is a compact JSON serialization of the same details.
- The tool result also supplies Pi `usage`: TypeSafe input/output token counts, zero cache counts, their sum as `totalTokens`, and zero cost because neither API exposes a stable request cost in its response.

- [ ] **Step 1: Write schema and preflight tests**

Add tests named:

- `rejects an empty question map without fetching`
- `accepts Noul, Choice, and Score questions in one request`
- `rejects Choice criteria outside 2–255 options without fetching`
- `rejects Score criteria outside 2–10 levels without fetching`
- `preserves prototype-sensitive question IDs`

Assert that the registered TypeBox schema carries the cardinality constraints and that runtime validation rejects invalid values before auth lookup or network access.

- [ ] **Step 2: Write direct request and success tests**

Add tests named:

- `uses registered TypeSafe auth before TYPESAFE_API_KEY`
- `uses TYPESAFE_API_KEY when the host has no TypeSafe provider`
- `serializes jev-latest and TypeSafe-native questions`
- `returns backend, concrete model, answers, raw usage, and Pi usage`
- `never sends x-cmd-zdr`

Capture the request and assert:

```typescript
expect(request.url).toBe("https://api.typesafe.ai/v1/systemone");
expect(request.headers.get("authorization")).toBe("Bearer direct-key");
expect(request.headers.has("x-cmd-zdr")).toBe(false);
expect(await request.json()).toEqual({ state, model: "jev-latest", questions });
```

Use a success fixture containing all three answer types, concrete model `jev-1.13.0`, and `{ input_tokens: 392, output_tokens: 65 }`.

- [ ] **Step 3: Write fallback-policy tests**

Add table-driven tests proving:

- missing direct credentials falls back;
- direct `401`, `403`, `429`, `529`, and representative `5xx` fall back exactly once;
- direct transport failure, timeout, and malformed `200` fall back exactly once;
- direct `400` and `422` are terminal and do not fall back;
- caller cancellation is terminal and does not fall back;
- missing credentials for both backends fails before fetch;
- fallback uses `typesafe/jev`, Command Code auth, and no `x-cmd-zdr`;
- fallback failure reports a sanitized status/category without either test key or response body.

The fallback request assertion is:

```typescript
expect(request.url).toBe("https://api.commandcode.ai/provider/v1/systemone");
expect(request.headers.get("authorization")).toBe("Bearer command-key");
expect(request.headers.has("x-cmd-zdr")).toBe(false);
expect(await request.json()).toEqual({ state, model: "typesafe/jev", questions });
```

- [ ] **Step 4: Run the focused tests and verify red**

Run:

```bash
pnpm vitest run tests/tools/typesafe-decide.test.ts
```

Expected: FAIL because `src/tools/typesafe-decide.ts` does not exist.

- [ ] **Step 5: Implement `registerTypeSafeDecisionTool` minimally**

In `src/tools/typesafe-decide.ts`:

- define the TypeBox parameter schema beside the tool;
- perform only the validation TypeBox cannot express reliably for dynamic maps and prototype-sensitive keys;
- create each request signal with `AbortSignal.any([callerSignal, AbortSignal.timeout(10_000)])` when a caller signal exists, otherwise use the timeout signal;
- distinguish caller cancellation from timeout by checking the original caller signal;
- parse JSON into own-key records and validate every requested answer, concrete model, and usage counters;
- classify direct failure once, then either throw a sanitized terminal error or make one fallback request;
- return compact JSON content, typed details, and normalized Pi usage.

Do not add transport classes, provider factories, retry helpers, or split the two fixed endpoints into separate files.

- [ ] **Step 6: Run focused and repository checks**

Run:

```bash
pnpm vitest run tests/tools/typesafe-decide.test.ts
pnpm check
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/tools/typesafe-decide.ts tests/tools/typesafe-decide.test.ts
git commit -m "feat: add typesafe decision tool"
```

## Phase Boundary

Phase 2 exports and tests the registration function but does not activate it in `src/index.ts`. Phase 3 owns that one-line wiring plus README, package metadata, and changelog updates.

## References

- Pi classifier/provider implementation: `/Users/lanh/Developer/pi-packages/pi` at commit `a328aa89a`
- Command Code Provider API: https://commandcode.ai/docs/provider
- Command Code GOAT plan: https://commandcode.ai/docs/plans/goat
- TypeSafe quick start: https://docs.typesafe.ai/introduction/quickstart
- TypeSafe API reference: https://docs.typesafe.ai/api

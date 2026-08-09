# Command Code Registration Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Command Code the same provider-specific registration boundary as MiniMax and StepFun without changing its native live-catalog provider behavior.

**Architecture:** Keep `createCommandCodeProvider()` as the native Pi `Provider` factory. Add a thin `registerCommandCode(pi)` adapter in the same module that creates the provider and passes it to Pi’s native `registerProvider(provider)` overload; make `src/index.ts` call that adapter like the other providers.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` 0.84.1, `@earendil-works/pi-coding-agent` 0.84.1, Vitest, Biome, pnpm, Node 24.15.0.

---

## Files and responsibilities

- Modify `tests/providers/command-code.test.ts`: add the failing-then-passing registration-helper test. Existing factory, live-catalog, ZDR, and cancellation tests remain the behavior coverage.
- Modify `src/providers/command-code.ts`: import the `ExtensionAPI` type and export the thin registration adapter. Do not alter parsing, fetching, refresh policy, model conversion, persistence, or ZDR logic.
- Modify `src/index.ts`: call `registerCommandCode(pi)` after `registerStepFun(pi)`.
- Modify no other runtime or documentation files. The approved design is recorded in `docs/superpowers/specs/2026-08-09-command-code-registration-design.md`.

### Task 1: Specify the registration adapter with a failing test

**Files:**

- Modify: `tests/providers/command-code.test.ts:1-13` imports and the provider test sections near the existing factory test.

- [ ] **Step 1: Import the adapter and add its focused test.**

Add `registerCommandCode` to the existing import from `../../src/providers/command-code.ts`, then add this test near `"creates a provider with both API families"`:

```ts
describe("Command Code registration", () => {
  it("registers the native Command Code provider", () => {
    const registerProvider = vi.fn();
    const pi = { registerProvider } as unknown as Parameters<
      typeof registerCommandCode
    >[0];

    registerCommandCode(pi);

    expect(registerProvider).toHaveBeenCalledOnce();
    expect(registerProvider.mock.calls[0]?.[0]).toMatchObject({
      id: "command-code",
    });
  });
});
```

The test intentionally checks the native provider object’s ID rather than a config object so a future implementation cannot silently convert away the live refresh lifecycle.

- [ ] **Step 2: Run only the new test and verify it fails.**

Run:

```bash
mise x node@24.15.0 -- pnpm vitest run tests/providers/command-code.test.ts -t "registers the native Command Code provider"
```

Expected: FAIL during module import or execution because `registerCommandCode` is not exported yet.

- [ ] **Step 3: Commit the failing test.**

```bash
git add tests/providers/command-code.test.ts
git commit -m "test: specify Command Code registration adapter"
```

### Task 2: Implement the adapter and use it from the extension entry point

**Files:**

- Modify: `src/providers/command-code.ts:1-5, around the exported factory`
- Modify: `src/index.ts:2-9`

- [ ] **Step 1: Add the type-only Extension API import.**

Extend the existing imports in `src/providers/command-code.ts` with:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
```

Keep it type-only so the provider module gains no runtime dependency or startup side effect.

- [ ] **Step 2: Add the minimal registration adapter.**

Place this immediately after `createCommandCodeProvider()`:

```ts
export function registerCommandCode(pi: ExtensionAPI): void {
  pi.registerProvider(createCommandCodeProvider());
}
```

Do not move or duplicate the provider construction. The adapter must delegate to the existing factory so the native `fetchModels`, refresh wrapper, mixed API map, and runtime ZDR behavior remain shared.

- [ ] **Step 3: Update `src/index.ts` to use the adapter.**

Change the import and call site to:

```ts
import { registerCommandCode } from "./providers/command-code.ts";

export default function createExtension(pi: ExtensionAPI): void {
  registerMiniMax(pi);
  registerStepFun(pi);
  registerCommandCode(pi);
}
```

Preserve the existing registration order: `minimax-openai`, `minimax-openai-cn`, `stepfun-ai`, then `command-code`.

- [ ] **Step 4: Run the focused provider and extension tests.**

Run:

```bash
mise x node@24.15.0 -- pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
```

Expected: all Command Code tests and extension registration tests pass; the index test still reports four providers in the existing order.

- [ ] **Step 5: Commit the implementation.**

```bash
git add src/providers/command-code.ts src/index.ts tests/providers/command-code.test.ts
git commit -m "refactor: align Command Code registration"
```

### Task 3: Verify behavior and package integration

**Files:** None; verification only.

- [ ] **Step 1: Run the full project check under the supported Node version.**

Run:

```bash
mise x node@24.15.0 -- pnpm check
```

Expected: format, lint, typecheck, all tests, and package verification pass. Existing unrelated lint warnings, if any, must remain outside the changed files.

- [ ] **Step 2: Verify ambient ZDR does not affect registration shape.**

Run:

```bash
CMD_ZDR=1 mise x node@24.15.0 -- pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
```

Expected: the registration helper still passes a native `command-code` provider, while the existing provider tests continue to cover runtime-only ZDR headers and headerless persistence.

- [ ] **Step 3: Inspect the final diff and package boundary.**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~2..HEAD
```

Expected: only the registration adapter, `src/index.ts` call-site, focused test, and their two implementation commits are present; no new dependency, config-style provider conversion, startup listener, or direct model-store write appears. The existing package verification confirms `src/index.ts` and `src/providers/command-code.ts` are shipped.

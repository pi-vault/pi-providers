# Command Code Catalog Correctness — Phase 1 Metadata Donor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

**Goal:** Upgrade the existing Pi metadata donor to 0.84.4 so current Command Code vision models receive correct reasoning, image-input, and output-limit metadata.

**Architecture:** Keep Command Code's converter and live overlay unchanged. Raise only the synchronized Pi package floor, then prove the existing donor lookup recognizes the six current vision-capable records.

**Tech Stack:** TypeScript 6, Node.js 24.15.0, pnpm, Vitest, `@earendil-works/pi-ai`, and `@earendil-works/pi-coding-agent`.

**Spec:** [docs/superpowers/plans/2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

## Global Constraints

- Require `@earendil-works/pi-ai >=0.84.4` and `@earendil-works/pi-coding-agent >=0.84.4`; use `^0.84.4` for development dependencies.
- Use the published packages resolved by pnpm as the metadata source of truth; do not depend on a separate local Pi checkout.
- Keep provider ID `command-code`, `CMD_API_KEY`, `CMD_ZDR=1`, public factory/registration signatures, endpoints, and refresh behavior unchanged.
- Reuse Pi 0.84.4's exact-ID and normalized-name donor metadata; do not add a local capability override table.
- Do not modify the bundled catalog, Command pricing, MiniMax, or StepFun in this phase.

**Prerequisite:** The parent plan exists and the current development dependencies resolve Pi 0.84.1.

**Usable result:** Live-discovered Command Code models receive current Pi capability metadata while the existing 52-model bundled baseline continues to work unchanged.

---

### Task 1: Lock and upgrade the metadata donor

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/providers/command-code.test.ts`

**Interfaces:**

- Consumes: `modelFromCatalogRecord(record: CommandCodeCatalogRecord): CommandCodeModel` and Pi's built-in provider catalog.
- Produces: Pi 0.84.4 donor metadata for current live model IDs without changing any Command Code API.

- [ ] **Step 1: Add the failing donor-metadata test**

Add this test after `uses Pi metadata while preserving Command identity and context`:

```ts
it("uses Pi metadata for current live vision models", () => {
  const cases = [
    {
      record: {
        id: "deepseek/deepseek-v4-flash-vision-exp",
        name: "DeepSeek V4 Flash Vision (exp)",
        contextWindow: 1_000_000,
      },
      expected: { reasoning: true, input: ["text", "image"], maxTokens: 384_000 },
    },
    {
      record: {
        id: "z-ai/glm-5.3-flash",
        name: "GLM-5.3 Flash",
        contextWindow: 1_048_576,
      },
      expected: { reasoning: true, input: ["text", "image"], maxTokens: 131_072 },
    },
    {
      record: {
        id: "Qwen/Qwen3.8-27B",
        name: "Qwen 3.8 27B",
        contextWindow: 262_144,
      },
      expected: { reasoning: true, input: ["text", "image"], maxTokens: 32_768 },
    },
    {
      record: {
        id: "Qwen/Qwen3.8-Flash",
        name: "Qwen 3.8 Flash",
        contextWindow: 1_000_000,
      },
      expected: { reasoning: true, input: ["text", "image"], maxTokens: 131_072 },
    },
    {
      record: {
        id: "google/gemini-3.7-flash",
        name: "Gemini 3.7 Flash",
        contextWindow: 1_048_576,
      },
      expected: { reasoning: true, input: ["text", "image"], maxTokens: 65_536 },
    },
    {
      record: {
        id: "xai/grok-4.6",
        name: "Grok 4.6",
        contextWindow: 500_000,
      },
      expected: { reasoning: true, input: ["text", "image"], maxTokens: 500_000 },
    },
  ] as const;

  for (const { record, expected } of cases) {
    expect(modelFromCatalogRecord(record), record.id).toMatchObject(expected);
  }
});
```

- [ ] **Step 2: Run the test against Pi 0.84.1 and verify it fails**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts -t "uses Pi metadata for current live vision models"
```

Expected: FAIL because Pi 0.84.1 gives these records the conservative unknown-model defaults.

- [ ] **Step 3: Raise the development and peer dependency floors**

Change only these four entries in `package.json`:

```json
"devDependencies": {
  "@earendil-works/pi-ai": "^0.84.4",
  "@earendil-works/pi-coding-agent": "^0.84.4"
},
"peerDependencies": {
  "@earendil-works/pi-ai": ">=0.84.4",
  "@earendil-works/pi-coding-agent": ">=0.84.4"
}
```

Keep every unrelated dependency and version unchanged.

- [ ] **Step 4: Regenerate the lockfile**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` resolves both synchronized Pi packages to versions satisfying `>=0.84.4`, with no unrelated direct dependency changes. With 0.84.4 as the latest compatible release, both resolve to 0.84.4; a later compatible 0.84.x patch is also valid.

- [ ] **Step 5: Verify the focused test and resolved versions**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts -t "uses Pi metadata for current live vision models"
pnpm list @earendil-works/pi-ai @earendil-works/pi-coding-agent --depth 0
```

Expected: the test passes for all six records and both direct development dependencies satisfy `>=0.84.4`.

- [ ] **Step 6: Run the full supported-runtime gate**

Run:

```bash
env npm_config_cache=/private/tmp/pi-providers-command-correctness-npm-cache mise x node@24.15.0 -- pnpm check
```

Expected: formatting, linting, type checking, the complete test suite, and package verification pass. This includes all existing Command Code catalog, conversion, transport, auth, ZDR, refresh, persistence, timeout, and cancellation tests.

- [ ] **Step 7: Inspect the scoped diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors, and only `package.json`, `pnpm-lock.yaml`, and `tests/providers/command-code.test.ts` are modified.

- [ ] **Step 8: Commit the atomic phase**

```bash
git add package.json pnpm-lock.yaml tests/providers/command-code.test.ts
git commit -m "fix: update Command Code model metadata donors"
```

## Phase 1 Acceptance Criteria

- Both Pi development packages resolve to versions satisfying `>=0.84.4`, and both peer floors are `>=0.84.4`.
- All six current live vision records inherit reasoning, image input, and output-limit metadata.
- The existing 52-model baseline, transport, registration, and refresh behavior are unchanged.
- The full Node.js 24.15.0 `pnpm check` gate passes.

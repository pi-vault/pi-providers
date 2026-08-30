# Command Code Catalog Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the bundled Command Code catalog, model metadata, and cost estimates in line with the public Provider API snapshot captured on 2026-08-29 without changing the working transport or refresh lifecycle.

**Architecture:** Keep the existing mixed Anthropic/OpenAI provider and Pi-managed live overlay unchanged. Upgrade the existing Pi metadata donor source to 0.84.4, extend the bundled baseline from 52 to the 62 models returned by `GET /provider/v1/models`, and update only the cost entries proven stale or newly required.

**Tech Stack:** TypeScript 6, Node.js 24.15.0, pnpm, Vitest, Biome, `@earendil-works/pi-ai`, and `@earendil-works/pi-coding-agent`.

**Spec:** Approved in-chat Command Code audit plan dated 2026-08-29; no separate repository design document was created for this audit spike.

## Global Constraints

- Require `@earendil-works/pi-ai >=0.84.4` and `@earendil-works/pi-coding-agent >=0.84.4`; use `^0.84.4` for development dependencies.
- Use the published packages resolved by pnpm as the metadata source of truth; do not depend on a separate local Pi checkout.
- Keep provider ID `command-code`, `CMD_API_KEY`, `CMD_ZDR=1`, and all public factory/registration signatures unchanged.
- Keep `https://api.commandcode.ai/provider/v1/chat/completions`, `/provider/v1/messages`, and `/provider/v1/models` unchanged.
- Keep Pi-managed persistence, offline restoration, four-hour freshness, failure retention, cancellation, and ZDR behavior unchanged.
- Treat the 62 records returned by the public Provider API on 2026-08-29 as the bundled baseline; do not add pricing-page-only models absent from that response.
- Do not add a local capability override table: reuse Pi 0.84.4's existing exact-ID and normalized-name donor metadata.
- Costs remain static estimates in USD per 1M tokens; preserve the zero-cost fallback for unknown future IDs.
- Do not modify MiniMax or StepFun source files or tests.

---

## Files and Responsibilities

- `package.json` and `pnpm-lock.yaml`: enforce and resolve the Pi 0.84.4 metadata floor.
- `src/providers/command-code/models.ts`: own the 62-model baseline and Command-specific cost overlay.
- `tests/providers/command-code.test.ts`: lock catalog membership, donor capabilities, costs, and existing provider behavior.
- `README.md` and `CHANGELOG.md`: state the 62-model snapshot, Pi version floor, and pricing limitations.

### Task 1: Upgrade the Pi Metadata Donor

**Files:**

- Modify: `package.json:55-64`
- Modify: `pnpm-lock.yaml`
- Test: `tests/providers/command-code.test.ts:215-246`

**Interfaces:**

- Consumes: `modelFromCatalogRecord(record: CommandCodeCatalogRecord): CommandCodeModel` and Pi's built-in provider catalog.
- Produces: correct `reasoning`, `input`, and `maxTokens` metadata for the six newly captured vision-capable model IDs without changing the converter API.

- [ ] **Step 1: Add a failing donor-metadata test**

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
      expected: {
        reasoning: true,
        input: ["text", "image"],
        maxTokens: 384_000,
      },
    },
    {
      record: {
        id: "z-ai/glm-5.3-flash",
        name: "GLM-5.3 Flash",
        contextWindow: 1_048_576,
      },
      expected: {
        reasoning: true,
        input: ["text", "image"],
        maxTokens: 131_072,
      },
    },
    {
      record: {
        id: "Qwen/Qwen3.8-27B",
        name: "Qwen 3.8 27B",
        contextWindow: 262_144,
      },
      expected: {
        reasoning: true,
        input: ["text", "image"],
        maxTokens: 32_768,
      },
    },
    {
      record: {
        id: "Qwen/Qwen3.8-Flash",
        name: "Qwen 3.8 Flash",
        contextWindow: 1_000_000,
      },
      expected: {
        reasoning: true,
        input: ["text", "image"],
        maxTokens: 131_072,
      },
    },
    {
      record: {
        id: "google/gemini-3.7-flash",
        name: "Gemini 3.7 Flash",
        contextWindow: 1_048_576,
      },
      expected: {
        reasoning: true,
        input: ["text", "image"],
        maxTokens: 65_536,
      },
    },
    {
      record: {
        id: "xai/grok-4.6",
        name: "Grok 4.6",
        contextWindow: 500_000,
      },
      expected: {
        reasoning: true,
        input: ["text", "image"],
        maxTokens: 500_000,
      },
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

Expected: FAIL because the listed records fall back to `reasoning: false`, `input: ["text"]`, and `maxTokens: 16384` under Pi 0.84.1.

- [ ] **Step 3: Raise the development and peer dependency floors**

Change the four package entries to:

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

- [ ] **Step 4: Regenerate the lockfile with the new versions**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` resolves the synchronized Pi packages to versions satisfying `>=0.84.4`, with no unrelated direct dependency changes. With 0.84.4 as the latest compatible release, both resolve to 0.84.4; a later compatible 0.84.x patch is also valid.

- [ ] **Step 5: Run the donor-metadata test and verify it passes**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts -t "uses Pi metadata for current live vision models"
```

Expected: PASS for all six vision-capable records.

- [ ] **Step 6: Verify the resolved dependency versions**

Run:

```bash
pnpm list @earendil-works/pi-ai @earendil-works/pi-coding-agent --depth 0
```

Expected: both direct development dependencies satisfy `>=0.84.4`.

- [ ] **Step 7: Run the full supported-runtime gate**

Run:

```bash
env npm_config_cache=/private/tmp/pi-providers-command-correctness-npm-cache mise x node@24.15.0 -- pnpm check
```

Expected: formatting, linting, type checking, the complete test suite, and package verification pass.

- [ ] **Step 8: Inspect the scoped phase diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors, and only `package.json`, `pnpm-lock.yaml`, and `tests/providers/command-code.test.ts` are modified.

- [ ] **Step 9: Commit the metadata donor upgrade**

```bash
git add package.json pnpm-lock.yaml tests/providers/command-code.test.ts
git commit -m "fix: update Command Code model metadata donors"
```

### Task 2: Synchronize the Bundled Catalog and Costs

**Files:**

- Modify: `src/providers/command-code/models.ts:116-260`
- Test: `tests/providers/command-code.test.ts:132-246`

**Interfaces:**

- Consumes: `CommandCodeCatalogRecord`, `COMMAND_COSTS`, and the Pi 0.84.4 donor catalog from Task 1.
- Produces: `COMMAND_CODE_CATALOG` and `commandCodeModels` containing the 62 live Provider API records captured on 2026-08-29.

- [ ] **Step 1: Update the catalog test to fail on the 52-model snapshot**

Replace the hard-coded 52 assertions in `bundles the captured Command Code catalog` with:

```ts
const newIds = [
  "deepseek/deepseek-v4-flash-vision-exp",
  "z-ai/glm-5.3-flash",
  "zai-org/GLM-5.3",
  "minimax/minimax-m3-free",
  "minimax/minimax-m2.7-free",
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3.8-Flash",
  "tencent/hy4-preview",
  "google/gemini-3.7-flash",
  "xai/grok-4.6",
];

expect(COMMAND_CODE_CATALOG).toHaveLength(62);
expect(new Set(COMMAND_CODE_CATALOG.map((model) => model.id)).size).toBe(62);
expect(COMMAND_CODE_CATALOG.map((model) => model.id)).toEqual(
  expect.arrayContaining(newIds),
);
expect(
  COMMAND_CODE_CATALOG.find((model) => model.id === "gpt-5.5")?.contextWindow,
).toBe(400_000);
expect(commandCodeModels).toHaveLength(62);
```

Retain the existing nonblank ID/name, positive integer context, and ID uniqueness checks. Remove the display-name uniqueness assertion: the paid/free MiniMax aliases intentionally share names.

Change the positive-price invariant to allow the three intentionally zero-cost IDs:

```ts
const zeroCostIds = new Set([
  "poolside/laguna-s-2.1-free",
  "minimax/minimax-m3-free",
  "minimax/minimax-m2.7-free",
]);

expect(
  commandCodeModels.every((model) => {
    if (zeroCostIds.has(model.id)) {
      return Object.values(model.cost).every((rate) =>
        Array.isArray(rate) ? true : rate === 0,
      );
    }
    return (
      model.cost.input > 0 &&
      model.cost.output > 0 &&
      [
        model.cost.input,
        model.cost.output,
        model.cost.cacheRead,
        model.cost.cacheWrite,
      ].every((rate) => Number.isFinite(rate) && rate >= 0)
    );
  }),
).toBe(true);
```

- [ ] **Step 2: Add failing price assertions for changed and new records**

In `uses Command’s stable and tiered pricing`, replace the old Claude Sonnet 5 and DeepSeek expectations and add these exact assertions:

```ts
expect(costFor("claude-sonnet-5")).toEqual({
  input: 2,
  output: 10,
  cacheRead: 0.2,
  cacheWrite: 2.5,
});
expect(costFor("deepseek/deepseek-v4-pro")).toEqual({
  input: 0.66,
  output: 1.98,
  cacheRead: 0.022,
  cacheWrite: 0,
});
expect(costFor("deepseek/deepseek-v4-flash")).toEqual({
  input: 0.22,
  output: 0.66,
  cacheRead: 0.007,
  cacheWrite: 0,
});
expect(costFor("deepseek/deepseek-v4-flash-vision-exp")).toEqual({
  input: 0.22,
  output: 0.66,
  cacheRead: 0.007,
  cacheWrite: 0,
});
expect(costFor("z-ai/glm-5.3-flash")).toEqual({
  input: 0.15,
  output: 0.5,
  cacheRead: 0.03,
  cacheWrite: 0,
});
expect(costFor("zai-org/GLM-5.3")).toEqual({
  input: 1.4,
  output: 4.4,
  cacheRead: 0.26,
  cacheWrite: 0,
});
expect(costFor("Qwen/Qwen3.8-27B")).toEqual({
  input: 0.4,
  output: 3,
  cacheRead: 0.04,
  cacheWrite: 0,
});
expect(costFor("Qwen/Qwen3.8-Flash")).toEqual({
  input: 0.16,
  output: 0.47,
  cacheRead: 0.016,
  cacheWrite: 0,
});
expect(costFor("tencent/hy4-preview")).toEqual({
  input: 0.834,
  output: 2.501,
  cacheRead: 0.042,
  cacheWrite: 0,
});
expect(costFor("google/gemini-3.7-flash")).toEqual({
  input: 1.5,
  output: 7.5,
  cacheRead: 0.15,
  cacheWrite: 0.04167,
});
expect(costFor("xai/grok-4.6")).toEqual({
  input: 2,
  output: 6,
  cacheRead: 0.5,
  cacheWrite: 0,
});
expect(costFor("minimax/minimax-m3-free")).toEqual({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
expect(costFor("minimax/minimax-m2.7-free")).toEqual({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
```

Keep the GPT-5.6 Terra/Luna tier assertions and the unknown-model zero fallback unchanged.

- [ ] **Step 3: Run the catalog and pricing tests and verify they fail**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts -t "bundles|pricing"
```

Expected: FAIL because the catalog still contains 52 records, GPT-5.5 still has a 200K baseline context, and changed/new costs do not match.

- [ ] **Step 4: Add the ten missing catalog records and correct GPT-5.5**

Insert each record into its existing provider group in `COMMAND_CODE_CATALOG`:

```ts
{ id: "deepseek/deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (exp)", contextWindow: 1_000_000 },
{ id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash", contextWindow: 1_048_576 },
{ id: "zai-org/GLM-5.3", name: "GLM-5.3", contextWindow: 1_000_000 },
{ id: "minimax/minimax-m3-free", name: "MiniMax M3", contextWindow: 1_000_000 },
{ id: "minimax/minimax-m2.7-free", name: "MiniMax M2.7", contextWindow: 197_000 },
{ id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", contextWindow: 262_144 },
{ id: "Qwen/Qwen3.8-Flash", name: "Qwen 3.8 Flash", contextWindow: 1_000_000 },
{ id: "tencent/hy4-preview", name: "Tencent Hy4 Preview", contextWindow: 1_048_576 },
{ id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", contextWindow: 1_048_576 },
{ id: "xai/grok-4.6", name: "Grok 4.6", contextWindow: 500_000 },
```

Change the existing GPT-5.5 record to:

```ts
{ id: "gpt-5.5", name: "GPT-5.5", contextWindow: 400_000 },
```

Change the existing DeepSeek Pro display name to match the live record:

```ts
{ id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (latest)", contextWindow: 1_000_000 },
```

Do not add Ling 3.0 Flash, Claude Opus 4.6, or Claude Sonnet 4.5 because they were absent from the Provider API response.

- [ ] **Step 5: Update the exact-ID cost overlay**

Change the snapshot comment to 2026-08-29. Replace the three stale entries and add the new paid/free entries with the values asserted in Step 2.

Place this comment immediately above the DeepSeek entries:

```ts
// ponytail: Pi ModelCost cannot express UTC price bands. These are Command's displayed
// off-peak estimates; replace them if /models exposes request-time pricing.
// Peak input/output: Pro 1.32/3.96; Flash and Flash Vision 0.44/1.32.
```

Use `ZERO_COST` for both explicit MiniMax free IDs:

```ts
"minimax/minimax-m3-free": ZERO_COST,
"minimax/minimax-m2.7-free": ZERO_COST,
```

Keep every unrelated existing cost entry unchanged.

- [ ] **Step 6: Run the complete Command Code test file**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts
```

Expected: all Command Code conversion, transport, auth, ZDR, registration, refresh, persistence, timeout, and cancellation tests pass.

- [ ] **Step 7: Commit the catalog synchronization**

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "fix: sync Command Code catalog and pricing"
```

### Task 3: Update Documentation and Run Release Verification

**Files:**

- Modify: `README.md:8-101`
- Modify: `CHANGELOG.md:8-15`

**Interfaces:**

- Consumes: the dependency floor and 62-model snapshot implemented by Tasks 1 and 2.
- Produces: user-facing installation, catalog, and pricing guidance matching runtime behavior.

- [ ] **Step 1: Update the README version and catalog summary**

Make these exact factual changes:

- Change `Command Code requires Pi 0.84.1 or newer` to `Command Code requires Pi 0.84.4 or newer`.
- Change the provider table entry from `52 bundled snapshot models` to `62 bundled snapshot models`.
- Change `The 52 bundled models remain the static baseline` to `The 62 bundled models captured on 2026-08-29 remain the static baseline`.

Replace the pricing portion of the Command Code known-limit paragraph with:

```markdown
Prices are dated estimates in USD per 1M tokens. Temporary offers use documented post-promotion rates where Command publishes them; explicit free model IDs remain zero while they are present in the live catalog. DeepSeek V4 uses the displayed off-peak estimate because Pi cannot represent UTC price bands, and its peak input/output rates are higher. Open-model routing and ZDR can also change the actual charge; Command's usage page remains authoritative.
```

Keep the existing live overlay, refresh, failure retention, API routing, and ZDR explanations.

- [ ] **Step 2: Update the unreleased changelog entries**

Replace the three current Command Code bullets with:

```markdown
- Static `command-code` provider with 62 bundled Command Code models captured on 2026-08-29, `CMD_API_KEY` authentication, Claude/Anthropic and OpenAI-compatible routing, and optional `CMD_ZDR=1` zero-data-retention requests.
- Command Code pricing metadata refreshed for current base, promotional, free-model, and DeepSeek UTC-band pricing, with unknown future models retaining the zero-cost fallback.
- Command Code live model discovery with Pi-managed persistent overlays, four-hour freshness checks and offline restore, catalog validation, prior-catalog retention after refresh failures, and Pi 0.84.4 metadata donors for current vision models.
```

- [ ] **Step 3: Format-check the touched files**

Run:

```bash
pnpm format:check
```

Expected: exit 0 with no files rewritten.

- [ ] **Step 4: Run the focused provider and registration tests**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
```

Expected: both test files pass; the provider still registers before MiniMax and StepFun and still exposes both API families.

- [ ] **Step 5: Run a read-only live catalog smoke check**

Run:

```bash
env CMD_API_KEY=audit-only mise x node@24.15.0 -- node --input-type=module --experimental-strip-types -e "import {createModels,InMemoryCredentialStore,InMemoryModelsStore} from '@earendil-works/pi-ai'; import {createCommandCodeProvider} from './src/providers/command-code.ts'; const credentials=new InMemoryCredentialStore(); await credentials.modify('command-code',async()=>({type:'api_key',key:'audit-only'})); const modelsStore=new InMemoryModelsStore(); const models=createModels({credentials,modelsStore}); models.setProvider(createCommandCodeProvider()); const result=await models.refresh({providers:['command-code'],force:true}); const stored=await modelsStore.read('command-code'); console.log(JSON.stringify({errors:[...result.errors].map(([id,error])=>[id,error.message]),listed:models.getModels('command-code').length,dynamic:stored?.models.length}));"
```

Expected on the 2026-08-29 snapshot:

```json
{ "errors": [], "listed": 62, "dynamic": 62 }
```

If Command adds or removes a model before implementation, stop and update the bundled snapshot, assertions, count, and documentation together from that newer complete response.

- [ ] **Step 6: Run the full supported-runtime gate**

Run:

```bash
env npm_config_cache=/private/tmp/pi-providers-command-correctness-npm-cache mise x node@24.15.0 -- pnpm check
```

Expected: formatting, lint, typecheck, all tests, and package verification exit 0. The existing unrelated `noNonNullAssertion` warnings may remain warnings; do not modify those files in this task.

- [ ] **Step 7: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: only `package.json`, `pnpm-lock.yaml`, the Command Code model source/test, README, and changelog differ from the task baseline; no transport, registration, MiniMax, or StepFun implementation changes appear.

- [ ] **Step 8: Commit the documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe current Command Code catalog"
```

## Final Acceptance Criteria

- The bundled baseline contains the exact 62 Provider API records captured on 2026-08-29, with GPT-5.5 at 400K context.
- Current live vision models inherit `reasoning`, image input, and output limits from Pi 0.84.4 rather than conservative unknown-model defaults.
- Changed and newly added costs match the locked estimates in this plan; future unknown IDs still receive `ZERO_COST`.
- Existing endpoints, auth headers, ZDR, refresh/persistence behavior, and registration order are unchanged.
- Focused tests and the full Node 24.15.0 `pnpm check` pass, with package contents verified.

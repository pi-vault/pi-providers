# Phase 3: StepFun Step 3.7 Flash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the multimodal Step 3.7 Flash model, complete StepFun documentation, and verify the package's automated release checks.

**Architecture:** Add one private static model record to the existing StepFun native OpenAI-compatible provider. Pi already maps model-level thinking settings to reasoning_effort and handles reasoning_content, so this phase adds neither a stream wrapper nor another compatibility setting.

**Tech Stack:** TypeScript, @earendil-works/pi-ai, @earendil-works/pi-coding-agent, Vitest, Biome, pnpm.

---

**Prerequisite:** Phases 1 and 2 are merged. src/providers/stepfun-ai.ts registers Step 3.5 Flash and Step 3.5 Flash 2603 with https://api.stepfun.ai/step_plan/v1 and $STEP_API_KEY.

## Source of truth

- Step Plan exposes step-3.7-flash, step-3.5-flash-2603, and step-3.5-flash in that order.
- Step 3.7 Flash supports text/image input, 256,000-token context and output limits, low/medium/high reasoning effort, and costs $0.20 input, $1.15 output, and $0.04 cache-read per million tokens.
- Keep $STEP_API_KEY. StepFun's Step Plan guide uses that variable and the existing provider already exposes it; do not replace it with models.dev's provider-level STEPFUN_API_KEY convention.

## File Map

- Modify: src/providers/stepfun-ai.ts — add the 3.7 record and documented model order.
- Modify: tests/providers/stepfun-ai.test.ts — assert the final catalog and full 3.7 metadata.
- Modify: README.md — document model selection, 3.7 facts, and reasoning controls.
- Modify: CHANGELOG.md — add the Unreleased StepFun entry.

### Task 1: Write the 3.7 registration test

**Files:**

- Modify: tests/providers/stepfun-ai.test.ts

- [ ] **Step 1: Replace the test with final-catalog assertions**

```ts
import { describe, expect, it, vi } from "vitest";
import { registerStepFun } from "../../src/providers/stepfun-ai.ts";

describe("registerStepFun", () => {
  it("registers the Step Plan endpoint and all three Step models", () => {
    const registerProvider = vi.fn();
    const pi = { registerProvider } as unknown as Parameters<
      typeof registerStepFun
    >[0];

    registerStepFun(pi);

    expect(registerProvider).toHaveBeenCalledOnce();
    const [name, config] = registerProvider.mock.calls[0];
    expect(name).toBe("stepfun-ai");
    expect(config).toMatchObject({
      name: "StepFun AI",
      baseUrl: "https://api.stepfun.ai/step_plan/v1",
      apiKey: "$STEP_API_KEY",
      api: "openai-completions",
    });
    expect(config.models.map((model: { id: string }) => model.id)).toEqual([
      "step-3.7-flash",
      "step-3.5-flash-2603",
      "step-3.5-flash",
    ]);
    expect(config.models[0]).toMatchObject({
      id: "step-3.7-flash",
      name: "Step 3.7 Flash",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 256_000,
      maxTokens: 256_000,
      cost: { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
      },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        supportsUsageInStreaming: false,
        maxTokensField: "max_tokens",
        supportsStrictMode: false,
        supportsLongCacheRetention: false,
      },
    });
    expect(config.models[1]).toMatchObject({
      id: "step-3.5-flash-2603",
      name: "Step 3.5 Flash 2603",
      reasoning: true,
      input: ["text"],
      contextWindow: 256_000,
      maxTokens: 256_000,
      cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: null,
        high: "high",
        xhigh: null,
      },
      compat: { supportsReasoningEffort: true },
    });
    expect(config.models[2]).toMatchObject({
      id: "step-3.5-flash",
      name: "Step 3.5 Flash",
      reasoning: true,
      input: ["text"],
      contextWindow: 256_000,
      maxTokens: 256_000,
      cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: null,
      },
      compat: { supportsReasoningEffort: false },
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: pnpm vitest run tests/providers/stepfun-ai.test.ts

Expected: FAIL because Step 3.7 Flash is absent and the current two-model order differs.

### Task 2: Add the static Step 3.7 Flash model

**Files:**

- Modify: src/providers/stepfun-ai.ts

- [ ] **Step 1: Add model37 and register the documented order**

Replace the file with:

```ts
import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const compat: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
};

const model: ProviderModelConfig = {
  id: "step-3.5-flash",
  name: "Step 3.5 Flash",
  reasoning: true,
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
  },
  input: ["text"],
  cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
  contextWindow: 256_000,
  maxTokens: 256_000,
  compat,
};

const model2603: ProviderModelConfig = {
  id: "step-3.5-flash-2603",
  name: "Step 3.5 Flash 2603",
  reasoning: true,
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
  },
  input: ["text"],
  cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
  contextWindow: 256_000,
  maxTokens: 256_000,
  compat: { ...compat, supportsReasoningEffort: true },
};

const model37: ProviderModelConfig = {
  id: "step-3.7-flash",
  name: "Step 3.7 Flash",
  reasoning: true,
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
  },
  input: ["text", "image"],
  cost: { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
  contextWindow: 256_000,
  maxTokens: 256_000,
  compat: { ...compat, supportsReasoningEffort: true },
};

export function registerStepFun(pi: ExtensionAPI): void {
  pi.registerProvider("stepfun-ai", {
    name: "StepFun AI",
    baseUrl: "https://api.stepfun.ai/step_plan/v1",
    apiKey: "$STEP_API_KEY",
    api: "openai-completions",
    models: [model37, model2603, model],
  });
}
```

- [ ] **Step 2: Run the focused tests**

Run: pnpm vitest run tests/providers/stepfun-ai.test.ts tests/index.test.ts

Expected: PASS; the StepFun test verifies all three models and the existing extension registration test remains passing.

- [ ] **Step 3: Commit the model and test changes**

```bash
git add src/providers/stepfun-ai.ts tests/providers/stepfun-ai.test.ts
git commit -m "feat: add StepFun 3.7 Flash model"
```

### Task 3: Complete user-facing documentation

**Files:**

- Modify: README.md
- Modify: CHANGELOG.md

- [ ] **Step 1: Update the StepFun README copy**

Change the provider bullet and usage copy to:

```markdown
- stepfun-ai provider for StepFun Step 3.5 and 3.7 Flash models through the Step Plan endpoint
```

```markdown
- Select stepfun-ai and choose step-3.7-flash, step-3.5-flash-2603, or step-3.5-flash for StepFun reasoning models.

Ask Pi normally — there is no provider-specific prompt syntax. All listed models support reasoning; image input is available with MiniMax-M3 and step-3.7-flash.
```

Insert this before the Step 3.5 Flash facts:

```markdown
### Model facts — step-3.7-flash

| Field                 | Value                               |
| --------------------- | ----------------------------------- |
| Context window        | 256,000 tokens                      |
| Max output tokens     | 256,000                             |
| Input modalities      | text, image                         |
| Reasoning             | low, medium, high                   |
| Cost (input / output) | $0.20 / $1.15 per 1M tokens         |
| Cost (cache read)     | $0.04 per 1M tokens                 |
| Cost (cache write)    | free                                |
| API base              | https://api.stepfun.ai/step_plan/v1 |
```

Replace the StepFun compatibility paragraph with:

```markdown
StepFun Step 3.5 Flash uses Pi's native OpenAI-compatible driver with max_tokens, without reasoning_effort, streaming usage options, strict tool schemas, developer-role prompts, or long cache retention. Step 3.5 Flash 2603 sends the documented low or high reasoning_effort selection; Step 3.7 Flash sends low, medium, or high.
```

- [ ] **Step 2: Add the changelog entry**

Insert this directly before the 0.1.0 release section:

```markdown
## [Unreleased]

### Added

- stepfun-ai provider for StepFun Step Plan models via the OpenAI-compatible endpoint.
```

- [ ] **Step 3: Audit documentation with FFF**

Call mcp**fff**multi_grep with:

```json
{
  "patterns": [
    "STEP_API_KEY",
    "STEPFUN_API_KEY",
    "stepfun-ai",
    "step_plan/v1",
    "step-3.7-flash"
  ],
  "constraints": "README.md CHANGELOG.md",
  "context": 1,
  "maxResults": 80
}
```

Expected: documentation uses STEP_API_KEY, stepfun-ai, and https://api.stepfun.ai/step_plan/v1; there is no STEPFUN_API_KEY match.

- [ ] **Step 4: Commit documentation changes**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: complete StepFun provider catalog"
```

### Task 4: Verify the release artifact

**Files:** None.

- [ ] **Step 1: Run automated release verification**

Run: pnpm release:check

Expected: exit code 0 after Biome lint, TypeScript typecheck, all Vitest tests, and pnpm pack --dry-run. Existing out-of-scope Biome non-null-assertion warnings may remain, but this phase must not add warnings or failures.

- [ ] **Step 2: Check the working tree**

Run: git status --short && git diff --check

Expected: no unstaged changes and no whitespace errors after the two commits.

- [ ] **Step 3: Perform the optional authenticated smoke test**

When a Step Plan subscription and STEP_API_KEY are available in a Pi checkout, confirm all three stepfun-ai models appear; send a text request with each; send an image request with Step 3.7 Flash; make a native tool call; and select Step 3.7 Flash reasoning at low, medium, and high.

Expected: each request succeeds. Record failures or missing credentials, but do not block automated implementation completion on this external check.

## Plan self-review

- Tasks 1–4 cover model metadata, ordering, endpoint, credential name, documentation, package verification, and optional live testing.
- Every code, test, and documentation edit is explicit; no placeholder work remains.
- ProviderModelConfig, OpenAICompletionsCompat, model IDs, and the private compat pattern match the current provider module.

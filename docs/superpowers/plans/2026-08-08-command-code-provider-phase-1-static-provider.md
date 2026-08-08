# Command Code Provider — Phase 1 Static Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-08-command-code-provider.md](./2026-08-08-command-code-provider.md)

**Goal:** Ship a usable static Command Code provider with mixed Anthropic/OpenAI routing and conservative model defaults.

**Prerequisite:** None. This phase intentionally does not perform runtime catalog discovery.

**Usable result:** Pi users can select bundled Command Code models, authenticate with `CMD_API_KEY`, send Claude and non-Claude requests, and opt into ZDR with `CMD_ZDR=1`. Model metadata changes only when the extension package is updated.

**Architecture:** Require Pi 0.84+, construct a native provider with `createProvider`, and use a bundled Command Code snapshot as its static model list. Claude IDs use `anthropic-messages`; all other IDs use `openai-completions`. Unknown capability and pricing fields use safe defaults until Phase 2 enriches them.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` 0.84+, `@earendil-works/pi-coding-agent` 0.84+, Vitest, Biome, pnpm.

---

## Files

- Modify `package.json` and `pnpm-lock.yaml` for the Pi 0.84+ contract.
- Create `src/providers/command-code/models.ts` for the bundled snapshot and conservative conversion.
- Create `src/providers/command-code.ts` for provider construction without `fetchModels`.
- Modify `src/index.ts` to register the provider.
- Create/modify `tests/providers/command-code.test.ts` for conversion and provider behavior.
- Modify `tests/index.test.ts` for registration order.
- Modify `README.md` and `CHANGELOG.md` with the static-provider behavior.

### Task 1: Upgrade the Pi dependency contract

- [ ] **Step 1: Change both Pi dependency ranges**

In `package.json`, set both development dependencies and both peer dependencies to `^0.84.1`:

```json
"@earendil-works/pi-ai": "^0.84.1",
"@earendil-works/pi-coding-agent": "^0.84.1"
```

- [ ] **Step 2: Refresh and typecheck dependencies**

Run:

```bash
pnpm install --lockfile-only
pnpm typecheck
```

Expected: the lockfile resolves Pi 0.84.1-compatible packages and the existing providers typecheck.

- [ ] **Step 3: Commit the dependency change**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: require Pi 0.84 provider APIs"
```

### Task 2: Add the static catalog and conservative conversion

- [ ] **Step 1: Capture the public model snapshot**

Run:

```bash
curl --fail --silent --show-error https://api.commandcode.ai/provider/v1/models \
  -o /tmp/command-code-models.json
```

Copy every returned record into `COMMAND_CODE_CATALOG` with only `id`, `name`, and `contextWindow`. Preserve unique IDs and do not add upstream-provider, pricing, or temporary-promotion fields.

- [ ] **Step 2: Write failing conversion tests**

Create `tests/providers/command-code.test.ts` with tests asserting Claude routing, non-Claude routing, Command-authoritative names/contexts, and unknown defaults:

```ts
it("routes Claude records to Anthropic Messages", () => {
  expect(modelFromCatalogRecord({
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    contextWindow: 1_000_000,
  })).toMatchObject({
    api: "anthropic-messages",
    provider: "command-code",
    contextWindow: 1_000_000,
  });
});

it("routes non-Claude records to OpenAI Completions", () => {
  expect(modelFromCatalogRecord({
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
  }).api).toBe("openai-completions");
});

it("uses conservative defaults when no Pi metadata exists", () => {
  expect(modelFromCatalogRecord({
    id: "new/vendor-model",
    name: "New Vendor Model",
    contextWindow: 32_000,
  })).toMatchObject({
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    maxTokens: 16_384,
  });
});
```

- [ ] **Step 3: Confirm the tests fail**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: failure because the catalog module does not exist.

- [ ] **Step 4: Implement `models.ts`**

Define the catalog record type, `COMMAND_CODE_BASE_URL`, `COMMAND_CODE_CATALOG`, `modelFromCatalogRecord`, and `commandCodeModels`. For Phase 1, every converted model must set:

```ts
{
  provider: "command-code",
  baseUrl: COMMAND_CODE_BASE_URL,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  maxTokens: Math.min(contextWindow, 16_384),
}
```

Set `api` from the Claude prefix rule and set OpenAI compatibility to `supportsStore: false`, `supportsDeveloperRole: false`, `supportsReasoningEffort: false`, `supportsUsageInStreaming: true`, `supportsStrictMode: false`, `supportsLongCacheRetention: false`, and `maxTokensField: "max_tokens"`.

- [ ] **Step 5: Run the conversion tests**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: PASS for every snapshot record and representative defaults.

- [ ] **Step 6: Commit the catalog slice**

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "feat: add static Command Code catalog"
```

### Task 3: Construct the native static provider

- [ ] **Step 1: Write provider construction tests**

Add tests that call `createCommandCodeProvider()` and assert its ID, name, base URL, static model list, and both API implementations. Stub `CMD_ZDR` before construction and assert the header is present only for the exact value `1`.

- [ ] **Step 2: Confirm provider tests fail**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: failure because `createCommandCodeProvider` is not defined.

- [ ] **Step 3: Implement the provider**

Import runtime symbols from `@earendil-works/pi-ai/compat` and construct:

```ts
export function createCommandCodeProvider(): Provider {
  return createProvider({
    id: "command-code",
    name: "Command Code",
    baseUrl: COMMAND_CODE_BASE_URL,
    headers: process.env.CMD_ZDR === "1" ? { "x-cmd-zdr": "1" } : undefined,
    auth: { apiKey: envApiKeyAuth("Command Code API key", ["CMD_API_KEY"]) },
    models: commandCodeModels,
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
    },
  });
}
```

Do not add `fetchModels` in this phase.

- [ ] **Step 4: Run provider tests**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: PASS with no network request required.

- [ ] **Step 5: Commit the provider slice**

```bash
git add src/providers/command-code.ts tests/providers/command-code.test.ts
git commit -m "feat: add static Command Code provider"
```

### Task 4: Register, document, and verify the static phase

- [ ] **Step 1: Update registration tests**

Update `tests/index.test.ts` to assert four registrations in order: `minimax-openai`, `minimax-openai-cn`, `stepfun-ai`, and `command-code`. Assert the fourth item is a native provider with ID `command-code`.

- [ ] **Step 2: Register the provider**

Append `pi.registerProvider(createCommandCodeProvider());` to `createExtension` after the existing providers. Do not add a `session_start` listener.

- [ ] **Step 3: Document the static phase**

Add `CMD_API_KEY`, optional `CMD_ZDR=1`, provider ID, endpoint routing, and the bundled-catalog limitation to `README.md`. Add an Unreleased changelog entry for the static provider.

- [ ] **Step 4: Run the phase gate**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
pnpm check
```

Expected: all tests, lint, typecheck, formatting, and package verification pass.

- [ ] **Step 5: Commit the static phase**

```bash
git add src/index.ts tests/index.test.ts README.md CHANGELOG.md
git commit -m "feat: register static Command Code provider"
```

## Phase 1 acceptance criteria

- A configured user can select any bundled Command Code model.
- Claude requests dispatch to Anthropic Messages and other requests to OpenAI Completions.
- `CMD_ZDR=1` adds `x-cmd-zdr: 1`; other values add no header.
- No runtime catalog fetch occurs.
- `pnpm check` passes.


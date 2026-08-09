# Command Code Provider — Phase 1 Static Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-08-command-code-provider.md](./2026-08-08-command-code-provider.md)

**Goal:** Ship an offline-capable native Command Code provider with a build-time snapshot of the current catalog, mixed Anthropic/OpenAI routing, Pi-derived capabilities, and optional ZDR.

**Prerequisite:** Pi 0.84.1 development dependencies are already installed by commit `9a38a71`; keep the existing wildcard peer dependencies.

**Usable result:** Pi users can select every model captured from Command Code’s public `/provider/v1/models` endpoint, send Claude and non-Claude requests, use known vision/reasoning/output metadata, authenticate with `CMD_API_KEY`, and opt into ZDR with `CMD_ZDR=1`. No catalog request occurs at runtime in this phase.

**Architecture:** Command Code owns model ID, display name, context window, endpoint, and API-family routing. Pi’s bundled catalog, generated from models.dev data, supplies portable reasoning, input, and output-limit traits through deterministic exact-ID/name matching. Costs remain zero until Phase 2 snapshots Command-specific prices.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` 0.84.1, `@earendil-works/pi-coding-agent` 0.84.1, native `fetch` for build-time capture, Vitest, Biome, pnpm.

---

## Files

- `src/providers/command-code/models.ts`: static snapshot, donor matching, conversion, and conservative compatibility defaults.
- `src/providers/command-code.ts`: native provider construction, auth, headers, and API implementations; no `fetchModels`.
- `src/index.ts`: native provider registration after the existing providers.
- `tests/providers/command-code.test.ts`: snapshot, conversion, provider, and ZDR tests.
- `tests/index.test.ts`: registration order and native-provider assertions.
- `package.json`, `README.md`, `CHANGELOG.md`: package metadata and user-facing documentation.

### Task 1: Add the static catalog and conversion

**Files:**

- Create: `src/providers/command-code/models.ts`
- Create: `tests/providers/command-code.test.ts`

- [ ] **Step 1: Capture and validate the Command snapshot**

Fetch `https://api.commandcode.ai/provider/v1/models` during implementation. Require `object === "list"`, a non-empty `data` array, unique nonblank string IDs/names, and positive integer `context_length` values. The current response contains 52 records. Commit only `id`, `name`, and `contextWindow`; omit `object`, timestamps, ownership, upstream names, and promotions.

- [ ] **Step 2: Write failing conversion tests**

Cover:

```ts
expect(
  modelFromCatalogRecord({
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    contextWindow: 1_000_000,
  }),
).toMatchObject({
  id: "claude-sonnet-5",
  api: "anthropic-messages",
  provider: "command-code",
  contextWindow: 1_000_000,
});
expect(
  modelFromCatalogRecord({
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
  }).api,
).toBe("openai-completions");
expect(
  modelFromCatalogRecord({
    id: "new/vendor-model",
    name: "New Vendor Model",
    contextWindow: 32_000,
  }),
).toMatchObject({
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  maxTokens: 16_384,
});
```

- [ ] **Step 3: Run the focused tests and confirm failure**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: failure because the catalog module does not exist.

- [ ] **Step 4: Implement deterministic Pi donor matching**

Import `getBuiltinProviders` and `getBuiltinModels` from `@earendil-works/pi-ai/providers/all`. Match exact model IDs first, then lowercase alphanumeric display names. Resolve duplicate donors by this fixed provider order, then lexical provider ID:

```ts
const PREFERRED_METADATA_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "google-vertex",
  "xai",
  "deepseek",
  "moonshotai",
  "minimax",
  "xiaomi",
  "zai",
  "qwen-token-plan",
  "kimi-coding",
  "together",
  "groq",
  "fireworks",
  "nvidia",
  "huggingface",
  "openrouter",
  "opencode",
  "cloudflare-ai-gateway",
  "github-copilot",
];
```

Copy only `reasoning`, `input`, and `maxTokens`, clamping output to Command’s context. For Claude donors, copy `thinkingLevelMap` and Anthropic `forceAdaptiveThinking`; do not copy donor provider, endpoint, API, headers, pricing, sampling, or gateway compatibility. Keep zero costs for every Phase 1 model.

- [ ] **Step 5: Implement conversion and export the baseline**

Return complete models with Command’s `id`, `name`, `contextWindow`, and `provider: "command-code"`. OpenAI models use `baseUrl: "https://api.commandcode.ai/provider/v1"`. Claude models use `baseUrl: "https://api.commandcode.ai/provider"` because Pi’s Anthropic SDK appends `/v1/messages`; the resulting request still targets Command’s documented `/provider/v1/messages` endpoint. Route IDs beginning with `claude-` to `anthropic-messages`; route all others to `openai-completions`. Use conservative OpenAI compatibility (`supportsStore: false`, `supportsDeveloperRole: false`, `supportsReasoningEffort: false`, `supportsUsageInStreaming: true`, `supportsStrictMode: false`, `supportsLongCacheRetention: false`, `maxTokensField: "max_tokens"`). Export `commandCodeModels = COMMAND_CODE_CATALOG.map(modelFromCatalogRecord)`.

- [ ] **Step 6: Run and commit the catalog slice**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: all snapshot, routing, donor, fallback, and zero-cost tests pass.

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "feat: add static Command Code catalog"
```

### Task 2: Build the native static provider

**Files:**

- Create: `src/providers/command-code.ts`
- Modify: `tests/providers/command-code.test.ts`

- [ ] **Step 1: Write provider tests**

Assert provider ID/name/base URL, 52 static models, both API implementations, `envApiKeyAuth("Command Code API key", ["CMD_API_KEY"])`, no `refreshModels`, and a header only when `CMD_ZDR === "1"`.

- [ ] **Step 2: Run tests and confirm failure**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: failure because `createCommandCodeProvider` does not exist.

- [ ] **Step 3: Implement the provider with stable Pi exports**

Import `createProvider` and `envApiKeyAuth` from `@earendil-works/pi-ai`. Import `anthropicMessagesApi` from `@earendil-works/pi-ai/api/anthropic-messages.lazy` and `openAICompletionsApi` from `@earendil-works/pi-ai/api/openai-completions.lazy`. Construct:

```ts
export function createCommandCodeProvider(): Provider<
  "anthropic-messages" | "openai-completions"
> {
  const headers = process.env.CMD_ZDR === "1" ? { "x-cmd-zdr": "1" } : undefined;

  return createProvider({
    id: "command-code",
    name: "Command Code",
    baseUrl: COMMAND_CODE_BASE_URL,
    headers,
    auth: { apiKey: envApiKeyAuth("Command Code API key", ["CMD_API_KEY"]) },
    // Pi API drivers transmit model headers; Provider.headers is metadata only in 0.84.1.
    models: headers ? commandCodeModels.map((model) => ({ ...model, headers })) : commandCodeModels,
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
    },
  });
}
```

Use a stubbed transport test for each API family to assert the final request URL, authentication header, and `x-cmd-zdr` header. Inspecting `Provider.headers` alone does not prove the privacy header is transmitted.

- [ ] **Step 4: Run and commit the provider slice**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: PASS without any network request.

```bash
git add src/providers/command-code.ts tests/providers/command-code.test.ts
git commit -m "feat: add static Command Code provider"
```

### Task 3: Register, document, and verify

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`
- Modify: `package.json`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update registration tests**

Assert registrations in order: `minimax-openai`, `minimax-openai-cn`, `stepfun-ai`, then a native provider with ID `command-code`. Assert the native provider exposes both API families.

- [ ] **Step 2: Register the provider**

Append `pi.registerProvider(createCommandCodeProvider());` after `registerStepFun(pi)`. Do not add a startup listener or runtime catalog fetch.

- [ ] **Step 3: Update package and user documentation**

Add Command Code to package description/keywords. Document `CMD_API_KEY`, optional `CMD_ZDR=1`, provider ID, Claude/OpenAI routing, the bundled snapshot limitation, Pi 0.84.1 requirement, and zero-cost/unknown-price behavior. Add an Unreleased changelog entry.

- [ ] **Step 4: Run the phase gate**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
pnpm check
```

Expected: all tests, typecheck, formatting, lint, and package verification pass under Node 24.15+.

- [ ] **Step 5: Commit the static phase**

```bash
git add src/index.ts tests/index.test.ts package.json README.md CHANGELOG.md
git commit -m "feat: register static Command Code provider"
```

## Phase 1 acceptance criteria

- All 52 captured Command models are selectable offline.
- Claude requests use Anthropic Messages; every other snapshot model uses OpenAI Chat Completions.
- Known Pi/model-catalog reasoning, vision, and output-limit traits are preserved without donor routing or pricing.
- `CMD_ZDR=1` adds `x-cmd-zdr: 1`; all other values add no header.
- No runtime catalog request occurs.
- `pnpm check` passes.

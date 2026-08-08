# Command Code Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pi 0.84+ native `command-code` provider with mixed Anthropic/OpenAI routing, cached live model discovery, Pi-derived metadata, and optional zero-data-retention headers.

**Architecture:** Register a native `Provider` built with Pi’s `createProvider` rather than the legacy provider-config form. Bundle a current Command Code catalog snapshot as the immediate baseline, derive portable traits from Pi’s bundled catalogs, and use a thin refresh wrapper for a four-hour freshness policy while letting Pi own persistence, restoration, concurrency, and failure retention.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` 0.84+, `@earendil-works/pi-coding-agent` 0.84+, native `fetch`, Vitest, Biome, pnpm.

**Reference contracts:** [Command Code Provider API](https://commandcode.ai/docs/provider), [Command Code pricing and limits](https://commandcode.ai/docs/resources/pricing-limits), [Pi custom providers](../../../../pi-packages/pi/packages/coding-agent/docs/custom-provider.md), and Pi’s native model lifecycle in `packages/ai/src/models.ts`.

---

## File map

- `package.json`, `pnpm-lock.yaml`: require Pi 0.84+ because `RefreshModelsContext` now exposes immutable `stored` state and transactional `publish` semantics.
- `src/providers/command-code/models.ts`: catalog snapshot, Pi-catalog trait matching, model conversion, compatibility defaults, and permanent price overrides.
- `src/providers/command-code.ts`: native provider construction, live catalog fetch/validation, four-hour freshness wrapper, and conditional ZDR headers.
- `src/index.ts`: register the native provider after the existing MiniMax and StepFun providers.
- `tests/providers/command-code.test.ts`: conversion, metadata, refresh, cache, validation, and provider behavior tests.
- `tests/index.test.ts`: extension registration order and native-provider registration assertions.
- `README.md`, `CHANGELOG.md`: installation, configuration, behavior, and release-note documentation.

### Task 1: Align dependencies with Pi 0.84+

**Files:**

- Modify: `package.json:52-64`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Update package dependency ranges**

Change both Pi development dependencies to `^0.84.1` and both peer dependencies from `*` to `^0.84.1`:

```json
"@earendil-works/pi-ai": "^0.84.1",
"@earendil-works/pi-coding-agent": "^0.84.1"
```

- [ ] **Step 2: Refresh the lockfile**

Run:

```bash
pnpm install --lockfile-only
```

Expected: Pi 0.84.1-compatible packages are resolved and no source files change.

- [ ] **Step 3: Verify the existing extension**

Run:

```bash
pnpm typecheck
```

Expected: the existing MiniMax and StepFun providers still typecheck.

- [ ] **Step 4: Commit the dependency slice**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: require Pi 0.84 provider APIs"
```

### Task 2: Add catalog conversion and Pi metadata matching

**Files:**

- Create: `src/providers/command-code/models.ts`
- Create: `tests/providers/command-code.test.ts`

- [ ] **Step 1: Capture the current Command catalog**

Fetch the public endpoint outside the repository:

```bash
curl --fail --silent --show-error https://api.commandcode.ai/provider/v1/models \
  -o /tmp/command-code-models.json
```

Copy every returned record into a typed `COMMAND_CODE_CATALOG` constant containing only `id`, `name`, and `contextWindow`. Require unique IDs and do not copy upstream-provider or temporary-pricing fields.

- [ ] **Step 2: Write failing conversion tests**

Add tests with these assertions:

```ts
it("routes Claude IDs to Anthropic and other IDs to OpenAI", () => {
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
    }),
  ).toMatchObject({
    api: "openai-completions",
  });
});

it("uses Pi traits but keeps Command name and context authoritative", () => {
  expect(
    modelFromCatalogRecord({
      id: "claude-sonnet-5",
      name: "Command Claude",
      contextWindow: 900_000,
    }),
  ).toMatchObject({
    name: "Command Claude",
    contextWindow: 900_000,
    input: ["text", "image"],
  });
});

it("uses conservative defaults for an unknown model", () => {
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
});
```

- [ ] **Step 3: Run the conversion tests and confirm failure**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: failure because `models.ts` and `modelFromCatalogRecord` do not exist.

- [ ] **Step 4: Implement deterministic Pi trait matching**

Import `getBuiltinModels` and `getBuiltinProviders` from `@earendil-works/pi-ai/providers/all`. Index bundled models by exact ID and normalized display name. Match exact IDs before names and choose duplicate candidates using this fixed provider order, then lexical provider-ID fallback:

```ts
const PREFERRED_METADATA_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "deepseek",
  "moonshotai",
  "minimax",
  "zai",
  "together",
  "huggingface",
  "openrouter",
  "opencode",
  "vercel-ai-gateway",
];
```

Copy only `reasoning`, `input`, `cost`, `maxTokens`, and `thinkingLevelMap`. Never copy donor `provider`, `baseUrl`, `api`, headers, sampling parameters, or gateway-specific `compat` values.

- [ ] **Step 5: Implement model conversion**

Construct a complete Pi model with `provider: "command-code"` and `baseUrl: COMMAND_CODE_BASE_URL`. Use the Command record’s `id`, `name`, and `contextWindow`. Select API with `id.startsWith("claude-")`. Clamp donor `maxTokens` to the context window. Unknown models use text-only, non-reasoning, zero-cost defaults with `maxTokens = Math.min(contextWindow, 16_384)` and OpenAI compatibility values `supportsStore: false`, `supportsDeveloperRole: false`, `supportsReasoningEffort: false`, `supportsUsageInStreaming: true`, `supportsStrictMode: false`, `supportsLongCacheRetention: false`, and `maxTokensField: "max_tokens"`.

- [ ] **Step 6: Add permanent Command pricing overrides**

Apply these permanent rates:

```ts
const COMMAND_COST_OVERRIDES = {
  "deepseek/deepseek-v4-pro": {
    input: 0.435,
    output: 0.87,
    cacheRead: 0.003625,
    cacheWrite: 0,
  },
  "MiniMaxAI/MiniMax-M3": {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.06,
    cacheWrite: 0,
  },
  "xiaomi/mimo-v2.5-pro": {
    input: 0.435,
    output: 0.87,
    cacheRead: 0.0036,
    cacheWrite: 0,
  },
  "xiaomi/mimo-v2.5": {
    input: 0.14,
    output: 0.28,
    cacheRead: 0.0028,
    cacheWrite: 0,
  },
} as const;
```

Do not encode temporary GPT promotions or Laguna’s capacity-limited free period; use stable donor/list rates for those models.

- [ ] **Step 7: Export the baseline and run tests**

Export `commandCodeModels = COMMAND_CODE_CATALOG.map(modelFromCatalogRecord)`. Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: PASS for conversion, routing, metadata matching, price overrides, and unknown defaults.

- [ ] **Step 8: Commit the catalog slice**

```bash
git add src/providers/command-code/models.ts tests/providers/command-code.test.ts
git commit -m "feat: add Command Code catalog metadata"
```

### Task 3: Build the native provider and Pi-managed refresh

**Files:**

- Create: `src/providers/command-code.ts`
- Modify: `tests/providers/command-code.test.ts`

- [ ] **Step 1: Write failing provider and refresh tests**

Use `createModels`, `InMemoryModelsStore`, configured API-key credentials, and stubbed `globalThis.fetch`. Cover offline restoration, fresh-cache skipping, stale replacement, force refresh, persistence, invalid responses, HTTP errors, timeouts, caller aborts, and ZDR headers:

```ts
it("restores a cached overlay during offline refresh", async () => {
  const modelsStore = new InMemoryModelsStore();
  await modelsStore.write("command-code", {
    models: [cachedModel],
    checkedAt: Date.now(),
  });
  const models = createModels({
    modelsStore,
    credentials: configuredCredentials,
  });
  models.setProvider(createCommandCodeProvider());

  const result = await models.refresh({ allowNetwork: false });

  expect(result.errors.size).toBe(0);
  expect(models.getModel("command-code", cachedModel.id)).toBeDefined();
});

it("skips a fresh online catalog without rewriting checkedAt", async () => {
  const checkedAt = Date.now();
  await modelsStore.write("command-code", { models: [cachedModel], checkedAt });
  vi.stubGlobal("fetch", vi.fn());

  await models.refresh({ providers: ["command-code"] });

  expect(fetch).not.toHaveBeenCalled();
  expect((await modelsStore.read("command-code"))?.checkedAt).toBe(checkedAt);
});

it("retains the previous catalog after invalid refresh data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(jsonResponse({ object: "list", data: [] })),
  );

  const result = await models.refresh({
    providers: ["command-code"],
    force: true,
  });

  expect(result.errors.get("command-code")).toBeInstanceOf(Error);
  expect(models.getModel("command-code", cachedModel.id)).toBeDefined();
});
```

- [ ] **Step 2: Run provider tests and confirm failure**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: failure because `createCommandCodeProvider` and the refresh implementation do not exist.

- [ ] **Step 3: Implement response validation**

Accept only this shape:

```ts
interface CommandCodeModelsResponse {
  object: "list";
  data: Array<{ id: string; name: string; context_length: number }>;
}
```

Reject empty lists, duplicate IDs, blank strings, non-integer context lengths, and non-positive context lengths. Convert `context_length` to `contextWindow` before model conversion.

- [ ] **Step 4: Implement the native provider**

Build the provider with runtime-supported symbols imported from `@earendil-works/pi-ai/compat`:

```ts
const provider = createProvider({
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
  fetchModels: fetchCommandCodeModels,
});
```

The fetcher must call `https://api.commandcode.ai/provider/v1/models` with a 10-second timeout combined with Pi’s supplied abort signal, validate the response, and return full converted models. It must throw on HTTP, timeout, parsing, or validation failure so Pi retains the active catalog and reports the provider error.

- [ ] **Step 5: Add the four-hour freshness wrapper**

Wrap the generated `provider.refreshModels` implementation so Pi still owns restoration and persistence:

```ts
const generatedRefresh = provider.refreshModels;
provider.refreshModels = async (context) => {
  if (
    context.allowNetwork &&
    !context.force &&
    context.stored?.checkedAt !== undefined &&
    Date.now() - context.stored.checkedAt < 4 * 60 * 60 * 1000
  ) {
    return;
  }
  await generatedRefresh?.(context);
};
```

The wrapper must not publish or rewrite `checkedAt` when skipping a fresh online phase.

- [ ] **Step 6: Run provider tests**

Run `pnpm vitest run tests/providers/command-code.test.ts`. Expected: PASS for restoration, freshness, forced refresh, persistence, validation, failure retention, timeout, abort, and ZDR behavior.

- [ ] **Step 7: Commit the provider slice**

```bash
git add src/providers/command-code.ts tests/providers/command-code.test.ts
git commit -m "feat: add native Command Code provider"
```

### Task 4: Register the provider in the extension

**Files:**

- Modify: `src/index.ts:1-8`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add a failing registration test**

Update the mock extension API to expose `registerProvider(provider)` and assert four registrations in order: `minimax-openai`, `minimax-openai-cn`, `stepfun-ai`, and `command-code`. Assert the fourth registration is a native provider with ID `command-code` and both API implementations.

- [ ] **Step 2: Run the registration test and confirm failure**

Run `pnpm vitest run tests/index.test.ts`. Expected: failure because only three providers are currently registered.

- [ ] **Step 3: Register Command Code**

Import `createCommandCodeProvider` and append this line to `createExtension`:

```ts
pi.registerProvider(createCommandCodeProvider());
```

Do not add a `session_start` listener; Pi handles cache restoration and normal startup refresh itself.

- [ ] **Step 4: Run registration tests**

Run `pnpm vitest run tests/index.test.ts tests/providers/command-code.test.ts`. Expected: PASS with four providers and correct native-provider registration.

- [ ] **Step 5: Commit registration**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: register Command Code in the extension"
```

### Task 5: Document and verify the release

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document configuration and runtime behavior**

Add `CMD_API_KEY` and optional `CMD_ZDR=1` to setup instructions. Document provider ID `command-code`, the public model endpoint, Claude/OpenAI routing, bundled baseline, four-hour refresh, cache fallback, and Pi 0.84+ requirement.

- [ ] **Step 2: Document pricing behavior**

Explain that Pi estimates use Command’s permanent rates where explicitly overridden, stable donor/list rates for ordinary models, and do not encode temporary promotions or capacity-limited free periods.

- [ ] **Step 3: Add the changelog entry**

Under the existing Unreleased section, add an Added entry describing the native Command Code provider, live catalog refresh, mixed API routing, cached fallback, and ZDR support.

- [ ] **Step 4: Run focused and package checks**

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
pnpm format:check
pnpm lint
pnpm typecheck
pnpm pack:verify
```

Expected: all commands pass with no formatting, lint, type, or package-content errors.

- [ ] **Step 5: Run the complete repository check**

Run `pnpm check`. Expected: the complete extension suite passes.

- [ ] **Step 6: Inspect the final diff**

```bash
git diff origin/master...HEAD --check
git status --short
```

Expected: only provider source, tests, package metadata/lockfile, documentation, and this plan are changed; no temporary catalog file is tracked.

- [ ] **Step 7: Perform an optional live smoke test**

With `CMD_API_KEY` configured, select one `claude-*` model and one non-Claude model and confirm both requests stream. Repeat one request with `CMD_ZDR=1`; accept either success or Command Code’s documented `422 cmd_zdr_no_providers` response for a model without a ZDR-capable upstream.

## Self-review checklist

- The plan targets Pi 0.84+ and contains no obsolete `context.store` API.
- No task relies on a `session_start` refresh or direct store implementation.
- Refresh failures retain the previous catalog through Pi’s native lifecycle.
- Unknown models, permanent pricing overrides, ZDR behavior, mixed routing, and package compatibility each have implementation and test coverage.
- The only runtime network request is the documented public Command Code models endpoint.

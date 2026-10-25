# Phase 2 — Command Code catalog and model-specific Flash controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a verified current bundled catalog and usable MiniMax Flash metadata/effort controls through Command Code.

**Architecture:** Retain the current extension registrations and Pi transports. Change local TypeSafe validation, refresh Command Code's existing catalog module, extract direct MiniMax metadata for reuse, and add a provider-scoped availability callback using Pi's storage/publication lifecycle.

**Tech Stack:** TypeScript ESM, Pi AI/coding-agent `^0.87.1`, TypeBox, Vitest, native fetch/AbortSignal, pnpm, Biome.

**Spec:** [Provider API Parity Specification](../specs/2026-10-25-provider-api-parity-design.md). Read the relevant subsystem section before each phase.

## Global Constraints

- Preserve provider IDs `minimax-openai`, `minimax-openai-cn`, and `command-code`, and tool name `typesafe_decide`.
- Preserve existing credential names, precedence, and login behavior.
- Keep MiniMax on OpenAI Chat Completions and preserve the custom stream-hardening pipeline.
- Keep the current dependencies, Node requirement `>=24.15.0`, and Pi development baseline `^0.87.1`.
- Leave StepFun behavior and registrations unchanged.
- Use mocked HTTP and frozen fixtures in automated tests; credentials and paid inference are not required for acceptance.
- Update README and an Unreleased changelog entry within each behavior phase; preserve historical release entries.
- Release numbering, publishing, and dependency upgrades are outside this work.

## Review Focus

- Criteria-only/null TypeSafe inputs must survive schema validation and serialization; test in phase 1.
- An oversized direct request must never become an oversized gateway fallback; test in phase 1.
- New paid Command Code aliases must not inherit retired free prices or guessed routes; test in phase 2.
- MiniMax reasoning must survive the actual second-turn wire request, including whitespace and multiple tools; test in phase 3.
- Empty, stale, regional, cancelled, or rejected MiniMax publications must not resurrect models or replace valid state; test in phase 4.


**Parent:** [Provider API Parity Implementation Plan](2026-10-25-provider-api-parity.md)  
**Source phase:** 02  
**Parent SHA-256 at extraction:** `84f3e0a8688e63eafebe530318a8c5bc50d3bdb04811c7e383a88ff1e69e22f2`

The phase section below is copied verbatim from the parent. Read the linked spec and inherited constraints; execute only this phase. Track progress here and leave the parent unchanged.

---

## Phase 2 — Command Code catalog and model-specific Flash controls

**Phase goal:** Ship a verified current bundled catalog and usable MiniMax Flash metadata/effort controls through Command Code.

**Prerequisites:** Existing baseline only; phase 1 may already be present.  
**Usable result:** Offline users see the refreshed bundle; successful live catalogs retain their existing authority, and Flash requests use their declared route and supported effort.  
**Spec:** Section 2 and Global constraints.

### Task 2: Refresh the snapshot and preserve transport/cache contracts

**Files:**

- Modify: `src/providers/command-code/models.ts`
- Modify only if needed for local metadata lookup: `src/providers/command-code.ts`
- Create: `tests/fixtures/command-code-models.json`
- Test: `tests/providers/command-code.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: `CommandCodeCatalogRecord`, `COMMAND_CODE_CATALOG`, `commandCodeModels`, `modelFromCatalogRecord(record: CommandCodeCatalogRecord): CommandCodeModel`, and `createCommandCodeProvider()`.
- Produces: the same exports with refreshed records; a local ID-keyed metadata overlay in the catalog module used for both bundled and live ID conversion.
- Retains: live fields over local metadata, local verified capabilities over donor/family defaults, existing unknown-live defaults, `COMMAND_CODE_FALLBACK_MAX_TOKENS = 32_768`, and the current cache version.

- [ ] **Step 1: Freeze catalog evidence before changing definitions.** Fetch the public models endpoint, using a normal HTTP User-Agent if a default client gets 403. Store the exact response in the fixture, with no credentials. Keep only supported chat records in production definitions. Record capture date/source in the catalog module. Resolve newly paid-model pricing and capabilities from official Command Code model/pricing pages; use the spec's 13-add/6-remove planning delta as a sanity check. A changed live response is acceptable when the fixture, definitions, and README all use the same capture. Report unverifiable prices explicitly; never substitute zero or claim a completed refresh without sourced rates.

- [ ] **Step 2: Add failing snapshot, conversion, and payload tests.** Replace brittle September count assertions with assertions against the frozen fixture. Compare exact ID sets, names, contexts, and endpoint declarations after excluding non-chat records. Pin newly added/retired IDs against the actual capture, and test that both bundled and metadata-poor live Flash records resolve identically.

```ts
expect([...bundledIds].sort()).toEqual([...fixtureChatIds].sort());
expect(flash.api).toBe("openai-completions");
expect(flash.input).toEqual(["text", "image"]);
expect(flash.maxTokens).toBe(32_768);
expect(flash.thinkingLevelMap).toEqual({
  off: null, minimal: null, low: "low", medium: "medium",
  high: "high", xhigh: "xhigh", max: "max",
});
expect(body.model).toBe("minimax/minimax-m3.1-flash");
expect(body.reasoning_effort).toBe("max");
expect(request.url).toBe("https://api.commandcode.ai/provider/v1/chat/completions");
```

Add cases named `keeps paid Ling separate from retired free aliases`, `uses captured endpoints rather than inferred endpoint families`, `uses verified capabilities without a Pi donor`, and `lets valid live metadata override local capabilities`. Assert every newly bundled paid model has sourced nonzero input/output rates and only verified current free models have zero rates. Preserve a test that Command Code still exposes `MiniMaxAI/MiniMax-M2.7` if the fixture advertises it. Exercise Flash low/medium/high/xhigh/max via the real Pi driver with mocked fetch, and assert its terminal stream usage is preserved.

Run the existing malformed catalog, offline restore, authoritative removal, credential, Responses, and ZDR tests unchanged wherever their assertions are not snapshot data.

- [ ] **Step 3: Verify the new tests fail before implementing the catalog changes.**

Run: `pnpm test -- tests/providers/command-code.test.ts`  
Expected: the bundle differs from the fixture and Flash's new capability/effort assertions fail.

- [ ] **Step 4: Update the existing catalog implementation.** Replace the bundled membership and exact endpoint declarations using the fixture. Refresh sourced costs/capabilities in the existing module; merge verified ID metadata into live conversions when those fields are absent. Do not overwrite explicit live values. Retain donor/family behavior for records without local metadata. Apply the Flash effort map and `supportsReasoningEffort` only to its Completions model; keep gateway `max_tokens` compatibility and the output fallback. Preserve transport selection and current cache/refresh implementation.

- [ ] **Step 5: Document the dated snapshot and verify the phase.** Update current README counts/date, example model availability, price caveats, and GOAT API access without hardcoding subscription entitlements. Add an Unreleased catalog entry. Run `pnpm test -- tests/providers/command-code.test.ts`, `pnpm check`, and `pnpm pack:dry-run`. Expected: all pass; the fixture stays out of the package and source definitions are included.

- [ ] **Step 6: Review and commit the atomic phase.**

```sh
git add src/providers/command-code/models.ts tests/fixtures/command-code-models.json tests/providers/command-code.test.ts README.md CHANGELOG.md
# Include src/providers/command-code.ts only if its metadata lookup changed.
git commit -m "feat: refresh Command Code catalog and Flash capabilities"
```

**Phase acceptance:** The fixture and bundle agree, paid/free metadata is accounted for, Flash makes valid gateway requests, and existing online/offline/ZDR behavior passes regression checks.

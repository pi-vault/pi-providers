# Command Code Catalog Correctness — Phase 4 Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

**Goal:** Document the 62-model Command Code snapshot and Pi 0.84.4 requirement, then prove the complete change is release-ready on the supported runtime.

**Architecture:** Change only user-facing facts that became stale in Phases 1–3. Finish with focused offline tests, a read-only live catalog comparison, the full supported-runtime gate, and a scope diff inspection.

**Tech Stack:** Markdown, TypeScript 6, Node.js 24.15.0, pnpm, Vitest, Biome, and the Command Code Provider API.

**Spec:** [docs/superpowers/plans/2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

## Global Constraints

- Document Pi 0.84.4, the 62-model snapshot captured on 2026-08-29, dated cost estimates, explicit free IDs, DeepSeek UTC-band limitations, and the unknown-ID fallback.
- Preserve the existing explanations for live overlays, four-hour freshness, offline restoration, refresh failure retention, routing, and ZDR.
- Keep provider code, endpoints, registration, MiniMax, and StepFun unchanged in this phase.
- If the live Provider API no longer returns the 62-record snapshot, stop release work and synchronize the parent assumptions, baseline, assertions, count, and docs together.

**Prerequisite:** Phases 1–3 are committed and their focused gates pass.

**Usable result:** Users receive accurate installation/catalog/pricing guidance, and maintainers have release evidence for both offline and live behavior.

---

### Task 1: Update user-facing documentation

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: the Pi 0.84.4 floor, 62-model baseline, and final static costs from Phases 1–3.
- Produces: installation, catalog, pricing, and release notes matching runtime behavior.

- [ ] **Step 1: Update the README facts**

Make these exact replacements:

- `Command Code requires Pi 0.84.1 or newer` → `Command Code requires Pi 0.84.4 or newer`.
- `52 bundled snapshot models` → `62 bundled snapshot models`.
- `The 52 bundled models remain the static baseline` → `The 62 bundled models captured on 2026-08-29 remain the static baseline`.

Replace only the pricing portion of the Command Code known-limit paragraph with:

```markdown
Prices are dated estimates in USD per 1M tokens. Temporary offers use documented post-promotion rates where Command publishes them; explicit free model IDs remain zero while they are present in the live catalog. DeepSeek V4 uses the displayed off-peak estimate because Pi cannot represent UTC price bands, and its peak input/output rates are higher. Open-model routing and ZDR can also change the actual charge; Command's usage page remains authoritative.
```

Keep the existing live overlay, refresh, failure retention, API routing, and ZDR explanations.

- [ ] **Step 2: Replace the unreleased Command Code bullets**

Replace the three current Command Code bullets in `CHANGELOG.md` with:

```markdown
- Static `command-code` provider with 62 bundled Command Code models captured on 2026-08-29, `CMD_API_KEY` authentication, Claude/Anthropic and OpenAI-compatible routing, and optional `CMD_ZDR=1` zero-data-retention requests.
- Command Code pricing metadata refreshed for current base, promotional, free-model, and DeepSeek UTC-band pricing, with unknown future models retaining the zero-cost fallback.
- Command Code live model discovery with Pi-managed persistent overlays, four-hour freshness checks and offline restore, catalog validation, prior-catalog retention after refresh failures, and Pi 0.84.4 metadata donors for current vision models.
```

- [ ] **Step 3: Run the non-writing format check**

Run:

```bash
pnpm format:check
```

Expected: exit 0 with no files rewritten.

- [ ] **Step 4: Commit the documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe current Command Code catalog"
```

### Task 2: Run the release gate

**Files:**

- Verify only: `package.json`, `pnpm-lock.yaml`, `src/providers/command-code/models.ts`, `tests/providers/command-code.test.ts`, `README.md`, and `CHANGELOG.md`

**Interfaces:**

- Consumes: the complete implementation from Phases 1–3 and the documentation from Task 1.
- Produces: reproducible evidence that offline, registration, live discovery, packaging, and supported-runtime checks pass.

- [ ] **Step 1: Run focused provider and registration tests**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
```

Expected: both files pass; Command Code remains registered before MiniMax and StepFun and exposes both API families.

- [ ] **Step 2: Run the read-only live catalog smoke check**

Run:

```bash
env CMD_API_KEY=audit-only mise x node@24.15.0 -- node --input-type=module --experimental-strip-types -e "import {createModels,InMemoryCredentialStore,InMemoryModelsStore} from '@earendil-works/pi-ai'; import {createCommandCodeProvider} from './src/providers/command-code.ts'; const credentials=new InMemoryCredentialStore(); await credentials.modify('command-code',async()=>({type:'api_key',key:'audit-only'})); const modelsStore=new InMemoryModelsStore(); const models=createModels({credentials,modelsStore}); models.setProvider(createCommandCodeProvider()); const result=await models.refresh({providers:['command-code'],force:true}); const stored=await modelsStore.read('command-code'); console.log(JSON.stringify({errors:[...result.errors].map(([id,error])=>[id,error.message]),listed:models.getModels('command-code').length,dynamic:stored?.models.length}));"
```

Expected for the approved snapshot:

```json
{"errors":[],"listed":62,"dynamic":62}
```

If Command has added or removed a model, stop. Update the bundled snapshot, tests, count, documentation, and parent assumptions together from the newer complete response before continuing.

- [ ] **Step 3: Run the full supported-runtime gate**

Run:

```bash
env npm_config_cache=/private/tmp/pi-providers-command-correctness-npm-cache mise x node@24.15.0 -- pnpm check
```

Expected: formatting, lint, typecheck, all tests, and package verification exit 0. Existing unrelated `noNonNullAssertion` warnings may remain warnings.

- [ ] **Step 4: Inspect whitespace, scope, and status**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: implementation commits touch only `package.json`, `pnpm-lock.yaml`, the Command Code model source/test, README, and changelog. No transport, registration, MiniMax, or StepFun implementation changes appear.

## Phase 4 Acceptance Criteria

- README and changelog state the Pi 0.84.4 floor, 62-model snapshot date, and pricing limitations accurately.
- Focused Command Code and registration tests pass.
- Live discovery reports no errors and matches the approved snapshot, or release work stops for a coordinated snapshot update.
- The Node 24.15.0 `pnpm check` gate passes with package contents verified.
- The final diff is limited to the parent plan's intended implementation files.

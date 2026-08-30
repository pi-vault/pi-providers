# Command Code Catalog Correctness — Phase 4 Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** [2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

**Goal:** Enforce and document the 62-model Command Code snapshot and Pi 0.84.4 requirement, then prove the complete change is release-ready on the supported runtime.

**Architecture:** Restore the omitted Pi peer-dependency floor, then change only user-facing facts that became stale in Phases 1–3. Finish with focused offline tests, an exact read-only live catalog comparison, the full supported-runtime gate, and a scope diff inspection from the pre-Phase-1 baseline.

**Tech Stack:** Markdown, TypeScript 6, Node.js 24.15.0, pnpm, Vitest, Biome, and the Command Code Provider API.

**Spec:** [docs/superpowers/plans/2026-08-29-command-code-catalog-correctness.md](./2026-08-29-command-code-catalog-correctness.md)

## Global Constraints

- Enforce `@earendil-works/pi-ai >=0.84.4` and `@earendil-works/pi-coding-agent >=0.84.4` as peer dependencies; keep the existing `^0.84.4` development dependencies.
- Document Pi 0.84.4, the 62-model snapshot captured on 2026-08-29, dated active promotional rates, explicit free IDs and their snapshot limitations, DeepSeek UTC-band limitations, and the unknown-ID fallback.
- Preserve the existing explanations for live overlays, four-hour freshness, offline restoration, refresh failure retention, routing, and ZDR.
- Keep provider code, endpoints, registration, MiniMax, and StepFun unchanged in this phase.
- If the live Provider API no longer returns the 62-record snapshot, stop release work and synchronize the parent assumptions, baseline, assertions, count, and docs together.

**Prerequisite:** Phases 1–3 are committed and their focused gates pass.

**Usable result:** Users receive accurate installation/catalog/pricing guidance, and maintainers have release evidence for both offline and live behavior.

---

### Task 1: Enforce the runtime floor and update user-facing documentation

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: the Pi 0.84.4 floor, 62-model baseline, and final static costs from Phases 1–3.
- Produces: install-time compatibility metadata plus installation, catalog, pricing, and release notes matching runtime behavior.

- [ ] **Step 1: Restore the Pi peer-dependency floor**

Change only these entries in `package.json`:

```json
"peerDependencies": {
  "@earendil-works/pi-ai": ">=0.84.4",
  "@earendil-works/pi-coding-agent": ">=0.84.4"
}
```

Keep the existing `^0.84.4` development dependencies unchanged. Do not run `pnpm install`: changing these root peer ranges does not change `pnpm-lock.yaml`.

Verify the manifest directly:

```bash
node -e "const p=require('./package.json'); for (const name of ['@earendil-works/pi-ai','@earendil-works/pi-coding-agent']) if (p.peerDependencies[name] !== '>=0.84.4') throw new Error(name)"
```

Expected: exit 0.

- [ ] **Step 2: Update the README facts**

Make these exact replacements:

- `Command Code requires Pi 0.84.1 or newer` → `Command Code requires Pi 0.84.4 or newer`.
- `52 bundled snapshot models` → `62 bundled snapshot models`.
- `The 52 bundled models remain the static baseline` → `The 62 bundled models captured on 2026-08-29 remain the static baseline`.

Replace only the pricing portion of the Command Code known-limit paragraph with:

```markdown
Prices are dated estimates in USD per 1M tokens. Temporary offers use the rates advertised on 2026-08-29 and may change or expire; explicit free model IDs are zero in this snapshot and must be refreshed when their offers expire or the IDs leave the live catalog. DeepSeek V4 uses the displayed off-peak estimate because Pi cannot represent UTC price bands, and its peak input/output rates are higher. Open-model routing and ZDR can also change the actual charge; Command's usage page remains authoritative.
```

Keep the existing live overlay, refresh, failure retention, API routing, and ZDR explanations.

- [ ] **Step 3: Replace the unreleased Command Code bullets**

Replace the three current Command Code bullets in `CHANGELOG.md` with:

```markdown
- Static `command-code` provider with 62 bundled Command Code models captured on 2026-08-29, `CMD_API_KEY` authentication, Claude/Anthropic and OpenAI-compatible routing, and optional `CMD_ZDR=1` zero-data-retention requests.
- Command Code pricing metadata refreshed for current base, promotional, free-model, and DeepSeek UTC-band pricing, with unknown future models retaining the zero-cost fallback.
- Command Code live model discovery with Pi-managed persistent overlays, four-hour freshness checks and offline restore, catalog validation, prior-catalog retention after refresh failures, and Pi 0.84.4 metadata donors for current vision models.
```

- [ ] **Step 4: Run the non-writing format check**

Run:

```bash
pnpm format:check
```

Expected: exit 0 with no files rewritten.

- [ ] **Step 5: Commit the compatibility metadata and documentation**

```bash
git add package.json README.md CHANGELOG.md
git commit -m "fix: enforce current Command Code requirements"
```

### Task 2: Run the release gate

**Files:**

- Verify only: `package.json`, `pnpm-lock.yaml`, `src/providers/command-code/models.ts`, `tests/providers/command-code.test.ts`, `README.md`, and `CHANGELOG.md`, excluding implementation-plan documents from the cross-phase scope check

**Interfaces:**

- Consumes: the complete implementation from Phases 1–3 and the documentation from Task 1.
- Produces: reproducible evidence that offline, registration, live discovery, packaging, and supported-runtime checks pass.

- [ ] **Step 1: Run focused provider and registration tests**

Run:

```bash
pnpm vitest run tests/providers/command-code.test.ts tests/index.test.ts
```

Expected: both files pass; Command Code remains registered before MiniMax and StepFun and exposes both API families.

- [ ] **Step 2: Run the exact read-only live catalog comparison**

Run:

```bash
env CMD_API_KEY=audit-only mise x node@24.15.0 -- node --input-type=module --experimental-strip-types -e "import {createModels,InMemoryCredentialStore,InMemoryModelsStore} from '@earendil-works/pi-ai'; import {createCommandCodeProvider} from './src/providers/command-code.ts'; import {commandCodeModels} from './src/providers/command-code/models.ts'; const credentials=new InMemoryCredentialStore(); await credentials.modify('command-code',async()=>({type:'api_key',key:'audit-only'})); const modelsStore=new InMemoryModelsStore(); const models=createModels({credentials,modelsStore}); models.setProvider(createCommandCodeProvider()); const result=await models.refresh({providers:['command-code'],force:true}); const stored=await modelsStore.read('command-code'); const project=(model)=>({id:model.id,name:model.name,contextWindow:model.contextWindow}); const sort=(items)=>items.map(project).sort((a,b)=>a.id.localeCompare(b.id)); const expected=sort(commandCodeModels); const actual=sort(stored?.models??[]); const errors=[...result.errors].map(([id,error])=>[id,error.message]); const matches=JSON.stringify(actual)===JSON.stringify(expected); console.log(JSON.stringify({errors,listed:models.getModels('command-code').length,dynamic:actual.length,matches})); if(errors.length||!matches) process.exitCode=1;"
```

Expected for the approved snapshot:

```json
{"errors":[],"listed":62,"dynamic":62,"matches":true}
```

This compares every live ID, name, and context window after the provider parses the response; equal counts alone are insufficient. If any record differs, stop. Inspect the complete response, then update the bundled snapshot, tests, count, documentation, and parent assumptions together before continuing.

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
git diff --name-only 863af03..HEAD -- . ':(exclude)docs/superpowers/plans/**'
git diff --stat 863af03..HEAD -- . ':(exclude)docs/superpowers/plans/**'
```

`863af03` is the merged planning baseline immediately before Phase 1. Expected: `git status` contains no unexpected implementation changes (plan checkbox tracking may remain), and the cross-phase implementation diff contains only `package.json`, `pnpm-lock.yaml`, `src/providers/command-code/models.ts`, `tests/providers/command-code.test.ts`, `README.md`, and `CHANGELOG.md`. No transport, registration, MiniMax, or StepFun implementation changes appear.

## Phase 4 Acceptance Criteria

- Package peer metadata enforces Pi 0.84.4, and README/changelog state the floor, 62-model snapshot date, active promotional-rate limitations, and free-ID refresh requirement accurately.
- Focused Command Code and registration tests pass.
- Live discovery reports no errors and exactly matches every approved ID, name, and context window, or release work stops for a coordinated snapshot update.
- The Node 24.15.0 `pnpm check` gate passes with package contents verified.
- The final diff is limited to the parent plan's intended implementation files.

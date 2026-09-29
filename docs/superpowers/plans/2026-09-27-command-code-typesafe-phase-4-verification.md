# Phase 4: Full Verification and Package Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the merged Command Code and TypeSafe work is scoped, reproducible, and packaged correctly for release review.

**Architecture:** Treat `v0.3.1` (`e939498`) as the immutable release baseline and verify the complete Phases 1–3 delta. Repair only the known documentation whitespace failure or a failure demonstrably introduced by that delta; do not add behavior during verification.

**Tech Stack:** Node.js 24, pnpm 11, Biome, TypeScript, Vitest, npm package dry-run, Git.

**Spec:** `docs/superpowers/plans/2026-09-27-command-code-typesafe-integration.md`, the phased plan beside it, and the completed Phase 1–3 plans.

## Global Constraints

- Require Node `>=24.15.0`; use the existing pnpm lockfile and package scripts.
- Use `e939498` (`v0.3.1`) as the scope-review baseline. Require merged Phase 3 commit `46be20b` to be an ancestor of the execution commit.
- Add no feature, provider, model, endpoint, SDK, runtime dependency, retry, or live billable API smoke test.
- Keep package version `0.3.1`, both Pi peer dependencies at `*`, and the existing `files` allowlist.
- Preserve the four provider registrations and their order; `typesafe_decide` remains a non-chat tool registered after them.
- Preserve direct TypeSafe `jev-latest` routing, Command Code `typesafe/jev` fallback, sanitized errors, and caller cancellation behavior.
- Never send `x-cmd-zdr` on System One requests. `CMD_ZDR=1` remains limited to Command Code chat-provider models.
- Do not refresh the dated Command Code catalog or prices in this phase. Live catalog drift is handled by runtime refresh and is not a verification failure.
- Change only `docs/superpowers/plans/2026-09-27-command-code-typesafe-phase-1-catalog.md` for the known trailing-blank-line cleanup, unless a later gate proves another Phase 1–3 regression.

## Current-State Gate

The repository is not ready to execute the original four-bullet plan. The branch is clean at merged Phase 3 commit `46be20b`, but the full integration range fails whitespace validation:

```text
docs/superpowers/plans/2026-09-27-command-code-typesafe-phase-1-catalog.md:78: new blank line at EOF.
```

The old Phase 4 plan had the same defect; this rewrite removes it. No product-code failure was observed during planning because Phase 4's verification commands were intentionally not executed ahead of the approved plan.

## Review Focus

- The reviewed range must start at `e939498`; reviewing only the last commit can miss Phase 1 or Phase 2 regressions.
- `git diff --check e939498` must pass after the single known Phase 1 plan cleanup.
- The package must contain the extension entry point, Command Code provider files, TypeSafe tool, README, changelog, license, and package metadata while excluding tests, implementation plans, credentials, and tarballs.
- Runtime scope must be limited to the intended Command Code changes, the TypeSafe tool and registration, and the three already-committed MiniMax type-compatibility edits required by the Pi dev-dependency update.
- Source, tests, and prose must agree with the TypeSafe and Command Code System One contracts, GOAT API access, backend billing visibility, and the documented Jev ZDR refusal.

---

### Task 1: Establish the integration range and repair diff hygiene

**Files:**

- Modify: `docs/superpowers/plans/2026-09-27-command-code-typesafe-phase-1-catalog.md`

**Interfaces:**

- Consumes: release baseline `e939498` and merged Phase 3 commit `46be20b`.
- Produces: a whitespace-clean integration diff without changing plan content.

- [ ] **Step 1: Confirm the execution preconditions**

Run:

```bash
git status --short
git merge-base --is-ancestor e939498 HEAD
git merge-base --is-ancestor 46be20b HEAD
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 24 || (major === 24 && minor >= 15) ? 0 : 1)'
```

Expected: every command exits 0 and there are no unrelated changes. The Phase 4 plan itself may be the sole change if it has not been committed yet; preserve any other user change and stop rather than folding it into this phase.

- [ ] **Step 2: Reproduce the known range failure**

Run:

```bash
git diff --check e939498
```

Expected: FAIL only for the trailing blank line at line 78 of the Phase 1 catalog plan. Any additional finding is new scope and must be investigated before editing.

- [ ] **Step 3: Remove the trailing blank line**

Delete only the extra blank line after the final reference in `docs/superpowers/plans/2026-09-27-command-code-typesafe-phase-1-catalog.md`. Do not rewrite plan prose.

- [ ] **Step 4: Verify and commit the hygiene fix**

Run:

```bash
git diff --check e939498
git diff -- docs/superpowers/plans/2026-09-27-command-code-typesafe-phase-1-catalog.md
```

Expected: the whitespace check exits 0 and the diff removes exactly one blank line.

Stage the Phase 1 cleanup and, if still uncommitted, this Phase 4 plan:

```bash
git add docs/superpowers/plans/2026-09-27-command-code-typesafe-phase-1-catalog.md docs/superpowers/plans/2026-09-27-command-code-typesafe-phase-4-verification.md
git commit -m "docs: prepare phase 4 verification"
```

### Task 2: Run the repository and package gates

**Files:**

- Verify: `package.json`
- Verify: npm package dry-run output
- Otherwise verify only. Modify a file only when a failure is traced to the `e939498..HEAD` integration range.

**Interfaces:**

- Consumes: `package.json`, `pnpm-lock.yaml`, `biome.json`, `tsconfig.json`, repository tests, the existing `pack:dry-run` script, and the `files` allowlist.
- Produces: a frozen-lockfile install plus passing format, lint, type, test, and package-content evidence.

- [ ] **Step 1: Verify the lockfile installs**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0 with no lockfile or manifest change.

- [ ] **Step 2: Run the complete repository check**

Run:

```bash
pnpm check
```

Expected: exit 0 from `format:check`, `lint`, `typecheck`, and `test`. Record the observed test-file and test counts; do not hard-code historical counts into the acceptance gate. Existing Biome `noNonNullAssertion` warnings may remain, but no new warning may originate in the integration range.

- [ ] **Step 3: Handle a failure without expanding scope**

If either command fails, inspect each exact path named by the failure with `git diff e939498 --` followed by that path:

- fix it minimally only when the integration range caused it, then rerun the narrow failing command followed by `pnpm check` and commit the fix separately;
- otherwise stop and report the external or pre-existing blocker without editing unrelated code.

- [ ] **Step 4: Confirm verification did not mutate tracked files**

Run:

```bash
git status --short
```

Expected: clean after Task 1's commit unless Step 3 produced a necessary, reviewed fix.

- [ ] **Step 5: Assert immutable package metadata**

Run:

```bash
node -e 'const p = require("./package.json"); const ok = p.version === "0.3.1" && p.engines?.node === ">=24.15.0" && p.dependencies === undefined && p.peerDependencies?.["@earendil-works/pi-ai"] === "*" && p.peerDependencies?.["@earendil-works/pi-coding-agent"] === "*"; process.exit(ok ? 0 : 1)'
```

Expected: exit 0. Dev-dependency updates already committed in Phase 2 are allowed; no runtime dependency is allowed.

- [ ] **Step 6: Run and inspect the package dry-run**

Run:

```bash
pnpm pack:dry-run
```

Expected: exit 0. Confirm the listing includes at least:

- `package.json`, `README.md`, `CHANGELOG.md`, and `LICENSE`;
- `src/index.ts`;
- `src/providers/command-code.ts` and `src/providers/command-code/models.ts`;
- `src/tools/typesafe-decide.ts`.

Confirm the listing excludes:

- `tests/` and `docs/superpowers/`;
- `.env`, `.npmrc`, or any other credential-bearing file;
- generated `*.tgz` archives.

- [ ] **Step 7: Confirm the dry-run left no artifact**

Run:

```bash
git status --short
```

Expected: clean; no tarball or tracked-file change exists.

### Task 3: Audit scope and external-contract alignment

**Files:**

- Review: the complete `e939498..HEAD` diff
- Reference: `/Users/lanh/Developer/pi-packages/pi` at `2b0a123de`

**Interfaces:**

- Consumes: the tested source, tests, documentation, package metadata, local Pi reference, and live upstream documentation.
- Produces: a release-review handoff with commands, results, package contents, scope conclusion, and any remaining risk.

- [ ] **Step 1: Review the complete file and whitespace scope**

Run:

```bash
git diff --name-status e939498..HEAD
git diff --check e939498..HEAD
```

Expected: the whitespace check passes. Runtime changes are limited to:

- `src/providers/command-code.ts` and `src/providers/command-code/models.ts`;
- `src/tools/typesafe-decide.ts` and its one registration in `src/index.ts`;
- the three MiniMax files containing the reviewed Pi type-compatibility edits.

Tests, package/tooling metadata, README, changelog, and planning documents may also differ. `.github/workflows/quality.yml` and `.github/workflows/release.yml` must remain unchanged.

- [ ] **Step 2: Review package and runtime diffs by responsibility**

Run:

```bash
git diff e939498..HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml biome.json
git diff e939498..HEAD -- src/index.ts src/providers/command-code.ts src/providers/command-code/models.ts src/tools/typesafe-decide.ts
git diff e939498..HEAD -- src/providers/minimax-openai.ts src/providers/minimax-openai/harden-tool-calls.ts src/providers/minimax-openai/normalize-tool-results.ts
git diff e939498..HEAD -- README.md CHANGELOG.md
```

Confirm:

- no package version, engine, peer-dependency, runtime-dependency, or release-workflow change;
- exactly four providers remain registered in their prior order and exactly one `typesafe_decide` tool is added after them;
- MiniMax changes are type-only compatibility updates, with no request or stream behavior change;
- System One errors never expose credentials, authorization headers, or response bodies;
- System One requests never contain `x-cmd-zdr`.

- [ ] **Step 3: Reconcile stable external contracts**

Re-read the references below and the local Pi checkout at commit `2b0a123de`. Confirm these stable facts still match source, tests, README, and changelog:

- TypeSafe direct requests use `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, and Noul/Choice/Score questions.
- Command Code fallback uses `POST https://api.commandcode.ai/provider/v1/systemone`, model `typesafe/jev`, and returns structured answers plus token usage without streaming.
- GOAT has Provider API access and Jev usage consumes the plan's model-specific credits; direct TypeSafe calls use the TypeSafe account.
- Command Code refuses `typesafe/jev` when `x-cmd-zdr: 1` is present, so the tool must continue omitting that header.
- Pi's provider-level `ModelRegistry.getApiKeyForProvider(provider)` remains the correct credential lookup for this tool. Do not replace the tool with newer unreleased classifier APIs during verification.

If a stable contract changed, stop and report that Phase 4 found a new implementation task. Do not fold an API migration into verification. Ignore volatile model-list and price drift already covered by the dated snapshot and live catalog refresh.

- [ ] **Step 4: Record the implementation handoff**

Report, without creating another repository file:

- the execution commit and baseline `e939498`;
- Node and pnpm versions;
- each verification command and exit status, including observed test counts;
- required and excluded package contents;
- scope and contract-review conclusions;
- any skipped check or remaining risk.

## References

- Pi runtime and credential API: `/Users/lanh/Developer/pi-packages/pi` at commit `2b0a123de`
- Command Code Provider API: https://commandcode.ai/docs/provider
- Command Code GOAT plan: https://commandcode.ai/docs/plans/goat
- TypeSafe quick start: https://docs.typesafe.ai/introduction/quickstart

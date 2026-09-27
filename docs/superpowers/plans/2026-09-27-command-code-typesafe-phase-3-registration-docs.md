# Phase 3: Extension Registration and Documentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TypeSafe capability active in the extension and discoverable/configurable by users.

**Depends on:** Phase 2 exports `registerTypeSafe` and its tests pass.

**Usable result:** A freshly installed extension registers the TypeSafe tool, and the README/changelog explain exactly how to configure it.

**Files:**

- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

## Steps

- [ ] Import and call `registerTypeSafe` from `src/index.ts` without changing existing provider registration order or behavior.
- [ ] Update package description/keywords to include TypeSafe.
- [ ] Document `TYPESAFE_API_KEY`, `CMD_API_KEY`, direct-first fallback order, non-chat `typesafe_decide` usage, backend billing visibility, and the ZDR limitation.
- [ ] Add an `Unreleased` changelog entry covering the 82-model Command refresh, endpoint-aware routing, and TypeSafe decision tool; do not change the version field.
- [ ] Run the full test suite plus formatting/lint checks.
- [ ] Commit with `git add src/index.ts README.md package.json CHANGELOG.md && git commit -m "docs: document command and typesafe providers"`.


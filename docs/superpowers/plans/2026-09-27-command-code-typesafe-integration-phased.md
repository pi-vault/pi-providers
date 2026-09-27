# Command Code and TypeSafe Integration Phased Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Each phase links to a standalone phase plan and ends with a usable, tested result.

**Goal:** Execute the approved Command Code refresh and TypeSafe integration in atomic increments, from the smallest provider-local change to release verification.

**Source plan:** [2026-09-27-command-code-typesafe-integration.md](./2026-09-27-command-code-typesafe-integration.md). That file is authoritative and must remain unchanged.

**Execution order:** Each phase is independently testable. Complete the previous phase’s verification before starting the next.

## Phases

### Phase 1 — Command Code catalog and routing

Updates the existing provider’s catalog contract, endpoint-aware routing, bundled 82-model snapshot, and dated pricing. Result: Command Code continues serving chat requests with current model metadata and its focused test suite passes.

Plan: [phase 1](./2026-09-27-command-code-typesafe-phase-1-catalog.md)

### Phase 2 — TypeSafe auth provider and decision tool

Adds the auth-only `typesafe` provider and `typesafe_decide` tool with direct TypeSafe calls and automatic Command Code `/systemone` fallback. Result: the new module can be registered and exercised through mocked HTTP tests without adding dependencies.

Plan: [phase 2](./2026-09-27-command-code-typesafe-phase-2-typesafe-tool.md)

### Phase 3 — Extension registration and user-facing documentation

Wires the TypeSafe registration into the extension and documents credentials, fallback behavior, non-chat usage, backend billing visibility, and the ZDR limitation. Result: installed users can discover and configure the complete integration.

Plan: [phase 3](./2026-09-27-command-code-typesafe-phase-3-registration-docs.md)

### Phase 4 — Full verification and package inspection

Runs the repository quality gates, package dry-run, and final scope review. Result: a release-ready package artifact with no accidental dependency, version, credential, or header regressions.

Plan: [phase 4](./2026-09-27-command-code-typesafe-phase-4-verification.md)

## Global sequencing rules

- Keep Node `>=24.15.0` and existing Pi peer dependencies.
- Use native `fetch`, TypeBox, and existing Pi credential/auth APIs; add no SDK or runtime dependency.
- Jev is never a selectable chat model.
- Keep Command Code non-Claude models on Chat Completions; do not add Responses API support.
- Prefer direct TypeSafe when configured; Command Code is the sole fallback.
- Never send `x-cmd-zdr` to System One requests.
- Do not bump the package version outside the release workflow.


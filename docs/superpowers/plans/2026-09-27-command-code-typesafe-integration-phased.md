# Command Code and TypeSafe Integration Phased Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Each phase links to a standalone phase plan and ends with a usable, tested result.

**Goal:** Execute the approved Command Code refresh and TypeSafe integration in atomic increments, from the smallest provider-local change to release verification.

**Source plan:** [2026-09-27-command-code-typesafe-integration.md](./2026-09-27-command-code-typesafe-integration.md) defines the overall integration. The standalone phase plans are authoritative for phase-specific interfaces, fixtures, pricing, and acceptance checks.

**Execution order:** Each phase is independently testable. Complete the previous phase’s verification before starting the next.

## Phases

### Phase 1 — Command Code catalog and routing

Updates the existing provider’s catalog contract, validates `supported_endpoints`, routes from endpoint declarations, refreshes the bundled 82-model snapshot, and pins the selected pricing policy. `/messages` takes precedence when both supported chat routes appear; `/responses`-only records are skipped. Result: Command Code serves the current chat catalog and retains cached data after malformed or unusable refreshes.

Plan: [phase 1](./2026-09-27-command-code-typesafe-phase-1-catalog.md)

### Phase 2 — TypeSafe auth provider and decision tool

Requires a design refresh before implementation: the referenced Pi package now exposes a native TypeSafe classifier provider and System One API, so the auth-only provider/tool boundary in the existing Phase 2 plan may duplicate upstream capability. Keep this phase after Phase 1, but do not treat its current plan as implementation-ready.

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
- Route Command Code models from `supported_endpoints`; keep Chat Completions as the only OpenAI implementation and do not add Responses API support.
- Prefer direct TypeSafe when configured; Command Code is the sole fallback.
- Never send `x-cmd-zdr` to System One requests.
- Do not bump the package version outside the release workflow.

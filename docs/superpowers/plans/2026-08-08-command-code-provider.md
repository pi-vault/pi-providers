# Command Code Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native Pi provider for Command Code with static capability metadata, Command-specific pricing, optional ZDR, and later validated live catalog discovery.

**Architecture:** Phase 1 bundles a build-time snapshot from Command Code’s public models endpoint and uses Pi’s bundled models.dev-derived catalog for portable capabilities. Phase 2 adds an official Command pricing snapshot. Phase 3 adds Pi-managed live refresh, persistence, freshness, and failure retention. Command identity, endpoint, and API routing remain authoritative throughout.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai` 0.84.1, `@earendil-works/pi-coding-agent` 0.84.1, native `fetch`, Vitest, Biome, pnpm.

**Reference contracts:** [Command Code Provider API](https://commandcode.ai/docs/provider), [Command Code pricing and limits](https://commandcode.ai/docs/resources/pricing-limits), [models.dev API](https://github.com/anomalyco/models.dev#api), [Pi custom providers](../../../../pi-packages/pi/packages/coding-agent/docs/custom-provider.md), and Pi’s native model lifecycle in `packages/ai/src/models.ts`.

---

## Phase map

| Phase                                                                        | Scope                                                                           | Runtime catalog network | Pricing       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------- | ------------- |
| [Phase 1](./2026-08-08-command-code-provider-phase-1-static-provider.md)     | Native provider, 52-model snapshot, Pi-derived capabilities, mixed routing, ZDR | None                    | Zero/unknown  |
| [Phase 2](./2026-08-08-command-code-provider-phase-2-metadata-enrichment.md) | Official Command cost snapshot                                                  | None                    | Command rates |
| [Phase 3](./2026-08-08-command-code-provider-phase-3-live-catalog.md)        | Validated live overlay, Pi persistence, four-hour freshness                     | Yes                     | Phase 2 rates |

## Shared invariants

- Provider ID is `command-code`; its public/OpenAI base URL is `https://api.commandcode.ai/provider/v1`. Claude model records use `https://api.commandcode.ai/provider` so Pi’s Anthropic SDK appends the correct `/v1/messages` path.
- IDs beginning with `claude-` use `anthropic-messages`; every other ID uses `openai-completions`.
- `CMD_API_KEY` is resolved with Pi’s `envApiKeyAuth`; `CMD_ZDR=1` adds `x-cmd-zdr: 1` to model headers so Pi’s API drivers transmit it.
- Command supplies model ID, display name, and context window. Donor catalogs never supply routing, endpoints, headers, or provider identity.
- Phase 1 and Phase 2 remain offline-capable. Phase 3 delegates restoration, publication, persistence, and failure retention to Pi’s native provider lifecycle.
- No new runtime dependency is added. Pi development dependencies are already at `^0.84.1`; wildcard peer dependencies remain unchanged for extension compatibility.

## Cross-phase verification

- Run focused provider and registration tests after every phase.
- Run `pnpm check` under Node 24.15+ at every phase gate.
- Run `git diff origin/master...HEAD --check` and inspect `git status --short` before declaring a phase complete.
- Do not add a `session_start` refresh or direct writes to Pi’s model store.

## Overall acceptance criteria

- A configured Pi user can select every model in the captured Command snapshot.
- Claude and non-Claude requests use the documented native endpoint families.
- ZDR behavior is opt-in and exact-value controlled.
- Capability and pricing metadata are explicitly versioned rather than silently inferred from runtime network state.
- Phase 3 can add and remove live models without losing a valid previous catalog after refresh failure.
- All phase gates pass `pnpm check`.

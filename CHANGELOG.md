# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Authenticated MiniMax availability discovery for `minimax-openai` and `minimax-openai-cn`. Each region queries its own `${baseUrl}/models` endpoint with its own credential, filters the response to the curated supported IDs, treats an empty supported result as authoritative, persists the last successful catalog, restores it offline, and throttles successful checks for four hours. Failed checks retain the prior catalog and remain retryable; regions and caches stay independent.
- Direct `MiniMax-M3.1-Flash` on `minimax-openai` and `minimax-openai-cn` with text/image input, 1,000,000-token context, a 524,288-token output ceiling through `max_completion_tokens`, standard $0.15 / $0.60 / $0.015 input/output/cache-read rates, and the five supported thinking efforts (`low`, `medium`, `high`, `xhigh`, `max`). Omitted effort preserves upstream behavior, and the simple provider path clamps `minimal` to `low`.
- Command Code `minimax/minimax-m3.1-flash` support with text and image input plus the five supported thinking efforts (`low`, `medium`, `high`, `xhigh`, `max`). Omitted effort preserves upstream behavior, and the simple provider path clamps `minimal` to `low`.

### Changed

- Direct `MiniMax-M3` now uses text/image input, a 524,288-token output ceiling with `max_completion_tokens`, and current standard $0.30 / $1.20 / $0.06 rates that double above 512,000 input tokens. `MiniMax-M2.7` and `MiniMax-M2.7-highspeed` are no longer bundled by the direct providers; Command Code's independent upstream records remain unchanged.
- MiniMax native reasoning now keeps exact whitespace and signatures, preserves interleaved thinking/text/tool arrival order, and splits resumed runs when Pi reuses a base content index.
- Refreshed the bundled Command Code catalog to 93 models captured 2026-10-25. Added 13 records and removed six retired or renamed ones, including the retired free Ling and stealth aliases; paid `inclusionai/ling-3.1-flash` keeps its own nonzero rates.
- Refreshed dated Command Code costs, including new exact-ID rates, Haiku 5.5 context tiers, and the retained Sonnet 5.5 cache-read estimate. Live metadata still overrides local capabilities and pricing.

### Fixed

- MiniMax preserves spaces, line breaks, and code indentation when visible text resumes after native reasoning, including when replaying that answer in the next request.
- MiniMax no longer trims reasoning fragments or deduplicates repeated prefixes, and no longer loses a reasoning signature when Pi delays `thinking_end` until after a text or tool boundary.
- Replaying an older same-model MiniMax session now converts unsigned thinking blocks into ordered `<think>` text without mutating the stored transcript or rewriting signed/foreign history.
- Command Code catalog conversion now treats model IDs matching inherited object properties as unknown models, preserving fallback metadata and successful refreshes.
- `typesafe_decide` now accepts the documented TypeSafe text-question contract: optional or null instructions, Noul questions described by a non-null `true` / `false` criterion when instructions are absent, 1–255 Choice options with nullable descriptions, and 1–10 non-null Score levels. Omitted fields and explicit null keep their distinct wire shapes.
- `typesafe_decide` blocks Command Code System One requests above 100 questions on both the initial gateway route and retryable fallback, while direct TypeSafe requests remain unrestricted. An oversized direct failure reports the sanitized direct cause plus the gateway restriction and is never split or forwarded.

## 2026-09-30 - [0.4.1]

### Added

- Command Code support for the `COMMAND_CODE_API_KEY` alias and catalog-only `CMD_MODELS_URL` override, with `CMD_API_KEY` retaining precedence.
- Live `pricing`, `modalities`, and `reasoning` metadata with strict catalog validation and cache retention for malformed refreshes.
- Official family and adaptive-thinking fallbacks while retaining the bundled snapshot and offline cache.

### Changed

- Command Code now ships an 86-model snapshot with refreshed 2026-09-30 prices, a 32,768 output fallback capped by context, and legacy cache migration.
- OpenAI Responses routing is supported alongside Anthropic Messages and OpenAI Chat Completions.

## 2026-09-29 - [0.4.0]

### Added

- `typesafe_decide`, a non-chat tool that answers typed Noul, Choice, and Score questions about a JSON state with TypeSafe Jev and returns structured probabilities instead of generated text. It calls TypeSafe directly with a host-resolved `typesafe` credential or `TYPESAFE_API_KEY`, and falls back to a single Command Code `typesafe/jev` request when direct access is absent or fails retryably. Direct `400` / `422` responses and cancellation are terminal and never fall back. System One requests never inherit `CMD_ZDR`, even when `CMD_ZDR=1`, because `typesafe/jev` has no ZDR-capable Command Code upstream. The tool does not provide an enforced-ZDR mode: a direct credential neither disables retryable Command Code fallback nor establishes ZDR for direct TypeSafe requests.

### Changed

- The bundled Command Code snapshot grew from 62 to 82 models, captured 2026-09-27.
- Command Code routing is now declared per catalog record: `/messages` takes precedence, `/chat/completions` is used otherwise, and records advertising only `/responses` are filtered out because this package does not implement Responses API transport.
- Refreshed Command Code pricing estimates against the 2026-09-27 rates.

## 2026-08-30 - [0.3.1]

### Changed

- Command Code provider switched to the `@earendil-works/pi-ai/compat` entry point so `anthropicMessagesApi`, `openAICompletionsApi`, and the `createProvider` / `Provider` / `RefreshModelsContext` imports come from a single module instead of three. Behavior is unchanged; all 110 tests still pass.

## 2026-08-30 - [0.3.0]

### Added

- `command-code` provider with 62 bundled snapshot models captured on 2026-08-29, `CMD_API_KEY` authentication, Claude/Anthropic and OpenAI-compatible routing, and optional `CMD_ZDR=1` zero-data-retention requests.
- Command Code pricing metadata covering current base, promotional, free-model, and DeepSeek UTC-band pricing; unknown future models fall back to the zero-cost default.
- Command Code live model discovery with Pi-managed persistent overlays, four-hour freshness checks with offline restore, catalog validation, and prior-catalog retention after refresh failures.

### Changed

- Dev dependency pins for `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` raised to `^0.84.4` so the build and tests run against the same baseline Command Code requires at runtime.
- Dev dependencies updated per the 48-hour freshness rule: `@biomejs/biome` to `^2.5.11`, `@types/node` to `^26.4.0`, `typebox` to `^1.3.20`, `vitest` to `^4.1.11`.
- TypeScript bumped from `^6.0.3` to `^7.0.2`. The codebase compiled and tested without code changes; `tsconfig.json` settings remained valid.
- Biome configuration migrated from `2.5.6` schema to `2.5.11` schema via `biome migrate --write` (only the `$schema` URL needed updating).

### Removed

- `pack:verify` script and the underlying `scripts/verify-pack.mjs` helper. `pnpm check` no longer runs the verify-pack step; `pnpm pack:dry-run` remains for ad-hoc tarball inspection.

## 2026-08-05 - [0.2.2]

### Added

- `MiniMax-M2.7` reasoning model on the `minimax-openai` and `minimax-openai-cn` providers (204,800 context, 131,072 max output, $0.30 / $1.20 per 1M tokens, $0.06 cache read, $0.375 cache write).
- `MiniMax-M2.7-highspeed` reasoning model on the same providers (same context as M2.7, $0.60 / $2.40 per 1M tokens, faster inference).

## 2026-08-01 - [0.2.1]

### Fixed

- Fail closed with a retryable provider error when MiniMax-M3 emits internal tool-call markup instead of OpenAI tool calls.

## 2026-07-12 - [0.2.0]

### Added

- `stepfun-ai` provider for StepFun Step Plan models via the OpenAI-compatible endpoint.
- `step-3.5-flash` reasoning model (256K context, text input, automatic reasoning shown as high in Pi).
- `step-3.5-flash-2603` reasoning model (256K context, text input, low/high reasoning effort).
- `step-3.7-flash` reasoning model (256K context, text + image input, low/medium/high reasoning effort).

### Changed

- MiniMax tool-call hardening pipeline (cleanStream, hardenToolCalls, normalizeToolResults, ThinkScanner) moved from `src/core/` to `src/providers/minimax-openai/` - StepFun uses Pi's native OpenAI-compatible stream without MiniMax-specific hardening.
- README restructured to a usage-first format with compact model comparison table.

## 2026-07-07 - [0.1.0]

### Added

- Initial public release of `@pi-vault/pi-providers` as a Pi package.
- `minimax-openai` provider registering `MiniMax-M3` against the MiniMax OpenAI-compatible API.
- `minimax-openai-cn` provider variant targeting the MiniMax CN endpoint.
- Tool-call hardening pipeline: `cleanStream`, `hardenToolCalls`, and `normalizeToolResults` wrappers applied to every provider stream.
- Model metadata for `MiniMax-M3`: 1M-token context, 512K max tokens, reasoning, text + image input, OpenAI-completions compatibility flags.

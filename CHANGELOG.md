# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-08-01

### Fixed

- Fail closed with a retryable provider error when MiniMax-M3 emits internal tool-call markup instead of OpenAI tool calls.

## [0.2.0] - 2026-07-12

### Added

- `stepfun-ai` provider for StepFun Step Plan models via the OpenAI-compatible endpoint.
- `step-3.5-flash` reasoning model (256K context, text input, automatic reasoning shown as high in Pi).
- `step-3.5-flash-2603` reasoning model (256K context, text input, low/high reasoning effort).
- `step-3.7-flash` reasoning model (256K context, text + image input, low/medium/high reasoning effort).

### Changed

- MiniMax tool-call hardening pipeline (cleanStream, hardenToolCalls, normalizeToolResults, ThinkScanner) moved from `src/core/` to `src/providers/minimax-openai/` - StepFun uses Pi's native OpenAI-compatible stream without MiniMax-specific hardening.
- README restructured to a usage-first format with compact model comparison table.

## [0.1.0] - 2026-07-07

### Added

- Initial public release of `@pi-vault/pi-providers` as a Pi package.
- `minimax-openai` provider registering `MiniMax-M3` against the MiniMax OpenAI-compatible API.
- `minimax-openai-cn` provider variant targeting the MiniMax CN endpoint.
- Tool-call hardening pipeline: `cleanStream`, `hardenToolCalls`, and `normalizeToolResults` wrappers applied to every provider stream.
- Model metadata for `MiniMax-M3`: 1M-token context, 512K max tokens, reasoning, text + image input, OpenAI-completions compatibility flags.

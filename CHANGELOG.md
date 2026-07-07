# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-07

### Added

- Initial public release of `@pi-vault/pi-providers` as a Pi package.
- `minimax-openai` provider registering `MiniMax-M3` against the MiniMax OpenAI-compatible API.
- `minimax-openai-cn` provider variant targeting the MiniMax CN endpoint.
- Tool-call hardening pipeline: `cleanStream`, `hardenToolCalls`, and `normalizeToolResults` wrappers applied to every provider stream.
- Model metadata for `MiniMax-M3`: 1M-token context, 512K max tokens, reasoning, text + image input, OpenAI-completions compatibility flags.

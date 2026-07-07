# @pi-vault/pi-providers

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-providers)](https://www.npmjs.com/package/@pi-vault/pi-providers)
[![Quality](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Register custom model providers for [Pi](https://github.com/earendil-works/pi-coding-agent).

## What it adds

- `minimax-openai` provider for MiniMax M3 against the global MiniMax endpoint
- `minimax-openai-cn` provider variant targeting the MiniMax China endpoint
- Tool-call hardening pipeline wrapped around every provider stream: stream cleaning, tool-call argument repair, and tool-result ordering

## Install

Install from npm:

```bash
pi install npm:@pi-vault/pi-providers
```

Then reload Pi:

```text
/reload
```

## Configure

Export the API key for the endpoint you want to use before launching Pi:

```bash
# Global MiniMax endpoint (minimax-openai)
export MINIMAX_API_KEY="..."

# China MiniMax endpoint (minimax-openai-cn)
export MINIMAX_CN_API_KEY="..."
```

The provider code passes `"$MINIMAX_API_KEY"` / `"$MINIMAX_CN_API_KEY"` to Pi, so Pi resolves the values from the environment at request time. If a variable is unset the corresponding provider cannot authenticate.

## Usage

Once installed and reloaded, the providers appear in Pi's model picker.

- Select `minimax-openai` (or `minimax-openai-cn`) as the provider.
- Choose the `MiniMax-M3` model.

Ask Pi normally — there is no provider-specific prompt syntax. Reasoning and image+text input work out of the box.

### Model facts — `MiniMax-M3`

| Field                 | Value                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| Context window        | 1,000,000 tokens                                                           |
| Max output tokens     | 512,000                                                                    |
| Input modalities      | text, image                                                                |
| Reasoning             | yes                                                                        |
| Cost (input / output) | $0.60 / $2.40 per 1M tokens                                                |
| Cost (cache read)     | $0.12 per 1M tokens                                                        |
| Cost (cache write)    | free                                                                       |
| API base              | `https://api.minimax.io/v1` (global) or `https://api.minimaxi.com/v1` (CN) |

### Compatibility flags

MiniMax M3 does not support every OpenAI field. Pi uses these flags when talking to it:

- `supportsStore: false`
- `supportsDeveloperRole: false`
- `supportsReasoningEffort: false`
- `maxTokensField: "max_tokens"`

## Notes and limits

- Both providers reuse Pi's built-in `openai-completions` driver and only override the base URL, API key, and event-stream hardening.
- The hardening pipeline folds inline `think` blocks emitted in `text` deltas into a proper `thinking` content block, repairs empty `{}` tool-call arguments via a second-chance JSON parse, and reorders tool-result messages to match the order of the preceding `tool_use` blocks — M3 rejects mismatched ordering.
- Tool-call argument collapse on deeply nested JSON schemas is a known M3 limitation; the package emits a diagnostic message instead of retrying.

## Development & Verification

```bash
pnpm install
pnpm check
pnpm release:check
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).

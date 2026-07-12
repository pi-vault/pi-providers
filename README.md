# @pi-vault/pi-providers

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-providers)](https://www.npmjs.com/package/@pi-vault/pi-providers)
[![Quality](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Register custom model providers for [Pi](https://github.com/earendil-works/pi-coding-agent).

## What it adds

- `minimax-openai` provider for MiniMax M3 against the global MiniMax endpoint
- `minimax-openai-cn` provider variant targeting the MiniMax China endpoint
- `stepfun-ai` provider for StepFun Step 3.5 and 3.7 Flash models through the Step Plan endpoint
- MiniMax tool-call hardening pipeline: stream cleaning, tool-call argument repair, and tool-result ordering

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

# StepFun Step Plan endpoint (stepfun-ai)
export STEP_API_KEY="..."
```

The provider code passes the corresponding `$MINIMAX_API_KEY`, `$MINIMAX_CN_API_KEY`, or `$STEP_API_KEY` reference to Pi, so Pi resolves the value from the environment at request time. If a variable is unset the corresponding provider cannot authenticate.

## Usage

Once installed and reloaded, the providers appear in Pi's model picker.

- Select `minimax-openai` (or `minimax-openai-cn`) as the provider.
- Choose the `MiniMax-M3` model.
- Select `stepfun-ai` and choose `step-3.7-flash`, `step-3.5-flash-2603`, or `step-3.5-flash` for StepFun reasoning models.

Ask Pi normally — there is no provider-specific prompt syntax. All listed models support reasoning; image input is available with `MiniMax-M3` and `step-3.7-flash`.

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

### Model facts — `step-3.7-flash`

| Field                 | Value                                             |
| --------------------- | ------------------------------------------------- |
| Context window        | 256,000 tokens                                    |
| Max output tokens     | 256,000                                           |
| Input modalities      | text, image                                       |
| Reasoning             | `low`, `medium`, `high`                           |
| Cost (input / output) | $0.20 / $1.15 per 1M tokens                       |
| Cost (cache read)     | $0.04 per 1M tokens                               |
| Cost (cache write)    | free                                              |
| API base              | `https://api.stepfun.ai/step_plan/v1`             |

### Model facts — `step-3.5-flash`

| Field                 | Value                                             |
| --------------------- | ------------------------------------------------- |
| Context window        | 256,000 tokens                                    |
| Max output tokens     | 256,000                                           |
| Input modalities      | text                                              |
| Reasoning             | automatic (Pi exposes `high`)                     |
| Cost (input / output) | $0.10 / $0.30 per 1M tokens                       |
| Cost (cache read)     | $0.02 per 1M tokens                               |
| Cost (cache write)    | free                                              |
| API base              | `https://api.stepfun.ai/step_plan/v1`             |

### Model facts — `step-3.5-flash-2603`

| Field                 | Value                                             |
| --------------------- | ------------------------------------------------- |
| Context window        | 256,000 tokens                                    |
| Max output tokens     | 256,000                                           |
| Input modalities      | text                                              |
| Reasoning             | `low`, `high`                                     |
| Cost (input / output) | $0.10 / $0.30 per 1M tokens                       |
| Cost (cache read)     | $0.02 per 1M tokens                               |
| Cost (cache write)    | free                                              |
| API base              | `https://api.stepfun.ai/step_plan/v1`             |

### Compatibility flags

MiniMax M3 does not support every OpenAI field. Pi uses these flags when talking to it:

- `supportsStore: false`
- `supportsDeveloperRole: false`
- `supportsReasoningEffort: false`
- `maxTokensField: "max_tokens"`

StepFun Step 3.5 Flash uses Pi's native OpenAI-compatible driver with `max_tokens`, without `reasoning_effort`, streaming usage options, strict tool schemas, developer-role prompts, or long cache retention. Step 3.5 Flash 2603 sends the documented `low` or `high` `reasoning_effort` selection; Step 3.7 Flash sends `low`, `medium`, or `high`.

## Notes and limits

- All providers reuse Pi's built-in `openai-completions` driver. MiniMax wraps its stream with provider-specific hardening; StepFun uses Pi's native stream handling.
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

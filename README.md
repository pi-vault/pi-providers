# @pi-vault/pi-providers

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-providers)](https://www.npmjs.com/package/@pi-vault/pi-providers)
[![Quality](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Register [MiniMax M3](https://www.minimax.io/) and [StepFun Flash](https://stepfun.ai/) reasoning models as custom providers for [Pi](https://github.com/earendil-works/pi).

## Install, Upgrade, And Reload

```bash
pi install npm:@pi-vault/pi-providers
```

Then reload Pi:

```text
/reload
```

## Quick Start

Set the API keys for the providers you want to use before launching Pi:

```bash
# MiniMax global endpoint (minimax-openai)
export MINIMAX_API_KEY="..."

# MiniMax China endpoint (minimax-openai-cn)
export MINIMAX_CN_API_KEY="..."

# StepFun Step Plan endpoint (stepfun-ai)
export STEP_API_KEY="..."
```

After reloading, the providers appear in Pi's model picker:

- Select `minimax-openai` (or `minimax-openai-cn`) and choose `MiniMax-M3`.
- Select `stepfun-ai` and choose one of `step-3.7-flash`, `step-3.5-flash-2603`, or `step-3.5-flash`.

Ask Pi normally; there is no provider-specific prompt syntax. Image input works with `MiniMax-M3` and `step-3.7-flash`.

## Providers And Models

| Provider                               | Model                       | Input       | Reasoning                 | Context   | Max output | Input / output per 1M tokens | Cache read |
| -------------------------------------- | --------------------------- | ----------- | ------------------------- | --------- | ---------- | ---------------------------- | ---------- |
| `minimax-openai` / `minimax-openai-cn` | `MiniMax-M3`                | text, image | yes                       | 1,000,000 | 512,000    | $0.60 / $2.40                | $0.12      |
| `minimax-openai` / `minimax-openai-cn` | `MiniMax-M2.7`              | text        | yes                       | 204,800   | 131,072    | $0.30 / $1.20                | $0.06      |
| `minimax-openai` / `minimax-openai-cn` | `MiniMax-M2.7-highspeed`    | text        | yes                       | 204,800   | 131,072    | $0.60 / $2.40                | $0.06      |
| `stepfun-ai`                           | `step-3.7-flash`            | text, image | low / medium / high       | 256,000   | 256,000    | $0.20 / $1.15                | $0.04      |
| `stepfun-ai`                           | `step-3.5-flash-2603`       | text        | low / high                | 256,000   | 256,000    | $0.10 / $0.30                | $0.02      |
| `stepfun-ai`                           | `step-3.5-flash`            | text        | automatic (shown as high) | 256,000   | 256,000    | $0.10 / $0.30                | $0.02      |

API bases:

- `minimax-openai`: `https://api.minimax.io/v1`
- `minimax-openai-cn`: `https://api.minimaxi.com/v1`
- `stepfun-ai`: `https://api.stepfun.ai/step_plan/v1`

Cache writes are free for `MiniMax-M3`. They cost $0.375 per 1M tokens for `MiniMax-M2.7` and `MiniMax-M2.7-highspeed`. They are free for all `stepfun-ai` models.

## Known Limits

- **Key matching.** The provider code passes the corresponding environment-variable reference (`$MINIMAX_API_KEY`, `$MINIMAX_CN_API_KEY`, `$STEP_API_KEY`) to Pi. If the variable is unset, the provider cannot authenticate.
- **MiniMax tool-call hardening.** The `minimax-openai` and `minimax-openai-cn` providers wrap their streams with a MiniMax-specific pipeline that folds inline `think` blocks into a proper `thinking` content block, repairs empty `{}` tool-call arguments via second-chance JSON parse, reorders tool-result messages to match the order of preceding `tool_use` blocks (the MiniMax API rejects mismatched ordering), and fails closed with a retryable error if the upstream ever emits internal tool-call markup instead of proper OpenAI tool calls.
- **StepFun native stream.** StepFun uses Pi's built-in OpenAI-compatible driver directly, without the MiniMax hardening pipeline.
- **Deeply nested tool schemas.** The MiniMax API may produce collapsed nested arguments on complex JSON schemas; this has been observed with `MiniMax-M3`. The package emits a diagnostic message instead of retrying.

## Development And Verification

```bash
pnpm install
pnpm check
pnpm release:check
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT. See [`LICENSE`](LICENSE).

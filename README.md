# @pi-vault/pi-providers

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-providers)](https://www.npmjs.com/package/@pi-vault/pi-providers)
[![Quality](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Register [MiniMax M3](https://www.minimax.io/), [StepFun Flash](https://stepfun.ai/), and [Command Code](https://commandcode.ai/) models as custom providers for [Pi](https://github.com/earendil-works/pi), and add a `typesafe_decide` tool for typed decision questions answered by [TypeSafe](https://typesafe.ai/) Jev. Command Code requires Pi 0.84.4 or newer.

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

# Command Code provider (command-code), and the typesafe_decide fallback backend
export CMD_API_KEY="..."

# Optional: direct TypeSafe credential for typesafe_decide (preferred)
export TYPESAFE_API_KEY="..."

# Optional: enforce zero data retention for Command Code chat-provider requests only
export CMD_ZDR=1
```

After reloading, the providers appear in Pi's model picker:

- Select `minimax-openai` (or `minimax-openai-cn`) and choose `MiniMax-M3`.
- Select `stepfun-ai` and choose one of `step-3.7-flash`, `step-3.5-flash-2603`, or `step-3.5-flash`.
- Select `command-code` and choose any bundled Command Code model.

Ask Pi normally; there is no provider-specific prompt syntax. Image input works with `MiniMax-M3` and `step-3.7-flash`.

`typesafe_decide` is a tool, not a selectable chat model, so it never appears in the model picker and never accepts a chat prompt. Pi calls it like any other tool — see [TypeSafe Decisions](#typesafe-decisions).

## What's New In 0.4.0

- **`typesafe_decide` tool** (new) — answers typed Noul, Choice, and Score questions against a JSON `state` with TypeSafe Jev and returns structured probabilities, not generated text. Calls TypeSafe System One directly when a `TYPESAFE_API_KEY` or host-resolved `typesafe` credential is present; otherwise makes a single fallback request to `typesafe/jev` through `command-code`. Direct `400` / `422` responses and cancellation are terminal and never fall back. System One requests never inherit `CMD_ZDR`, because `typesafe/jev` has no ZDR-capable Command Code upstream — the tool provides no enforced-ZDR mode.
- **Command Code catalog refreshed to 82 models** — snapshot captured 2026-09-27 (was 62). Routing is declared per record: `/messages` takes precedence, `/chat/completions` is used otherwise, and records advertising only `/responses` are filtered out because this package does not implement Responses API transport. Pricing estimates were also refreshed against the 2026-09-27 rates. See [`CHANGELOG.md`](CHANGELOG.md) for the full release notes.

## What's New In 0.3.1

- **`command-code` import consolidation** — `command-code.ts` now imports `anthropicMessagesApi`, `openAICompletionsApi`, `createProvider`, `Provider`, and `RefreshModelsContext` from a single `@earendil-works/pi-ai/compat` entry point. No behavior change.

## What's New In 0.3.0

- **`command-code` provider** (new) — `CMD_API_KEY` authentication, optional `CMD_ZDR=1` zero-data-retention requests, and endpoint-declared routing (Anthropic Messages when the record declares `/messages`, otherwise OpenAI Chat Completions).
- **Live catalog overlay** — Command Code fetches its model list from `https://api.commandcode.ai/provider/v1/models`, refreshes at most every four hours, and persists the last successful overlay for offline restore. On first run, or after a refresh failure, the bundled snapshot stays visible until a refresh succeeds.
- **Toolchain updates** — TypeScript 7, Biome 2.5.11 schema. No code changes were required for the TypeScript bump. See [`CHANGELOG.md`](CHANGELOG.md) for the full release notes.

## Providers And Models

| Provider                               | Model                      | Input       | Reasoning                 | Context   | Max output | Input / output per 1M tokens | Cache read |
| -------------------------------------- | -------------------------- | ----------- | ------------------------- | --------- | ---------- | ---------------------------- | ---------- |
| `minimax-openai` / `minimax-openai-cn` | `MiniMax-M3`               | text, image | yes                       | 1,000,000 | 512,000    | $0.60 / $2.40                | $0.12      |
| `minimax-openai` / `minimax-openai-cn` | `MiniMax-M2.7`             | text        | yes                       | 204,800   | 131,072    | $0.30 / $1.20                | $0.06      |
| `minimax-openai` / `minimax-openai-cn` | `MiniMax-M2.7-highspeed`   | text        | yes                       | 204,800   | 131,072    | $0.60 / $2.40                | $0.06      |
| `stepfun-ai`                           | `step-3.7-flash`           | text, image | low / medium / high       | 256,000   | 256,000    | $0.20 / $1.15                | $0.04      |
| `stepfun-ai`                           | `step-3.5-flash-2603`      | text        | low / high                | 256,000   | 256,000    | $0.10 / $0.30                | $0.02      |
| `stepfun-ai`                           | `step-3.5-flash`           | text        | automatic (shown as high) | 256,000   | 256,000    | $0.10 / $0.30                | $0.02      |
| `command-code`                         | 82 bundled snapshot models (captured 2026-09-27) | varies      | varies                    | varies    | varies     | dated snapshot               | varies     |

API bases:

- `minimax-openai`: `https://api.minimax.io/v1`
- `minimax-openai-cn`: `https://api.minimaxi.com/v1`
- `stepfun-ai`: `https://api.stepfun.ai/step_plan/v1`
- `command-code`: `https://api.commandcode.ai/provider/v1`

Cache writes are free for `MiniMax-M3`. They cost $0.375 per 1M tokens for `MiniMax-M2.7` and `MiniMax-M2.7-highspeed`. They are free for all `stepfun-ai` models.

## TypeSafe Decisions

`typesafe_decide` is a Pi tool, not a chat model. It takes a JSON `state` plus one or more named questions and returns **structured probabilities**, not generated text:

- **Noul** — a yes/no question with optional `true` / `false` criteria.
- **Choice** — a question over 2–255 named options, each with an optional rubric.
- **Score** — a question over 2–10 ordered level descriptions.

See the [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart) for how to construct questions, and the [TypeSafe API reference](https://docs.typesafe.ai/api) for the full upstream contract. A request using all three question types:

```json
{
  "state": { "repo": "pi-providers", "phase": "release review" },
  "questions": {
    "ship_now": {
      "type": "noul",
      "instructions": "Is the release safe to ship today?",
      "criteria": { "true": "All gates pass", "false": "Any gate is open" }
    },
    "risk_level": {
      "type": "score",
      "instructions": "How risky is shipping today?",
      "criteria": ["low", "moderate", "high"]
    },
    "next_step": {
      "type": "choice",
      "instructions": "What should happen next?",
      "criteria": { "ship": "No blockers remain", "fix": "Address open gates" }
    }
  }
}
```

**Routing.** The tool prefers direct TypeSafe access: with a configured credential it calls `jev-latest` on the TypeSafe System One API. If no direct credential is available, or a direct attempt fails in a retryable way, it may make a single fallback request to `typesafe/jev` through Command Code. Direct `400` / `422` responses mean the request itself is invalid, and a cancelled call is terminal — neither falls back. Credentials are resolved in this order: a host-resolved `typesafe` credential, then a non-blank `TYPESAFE_API_KEY`, then `command-code` fallback auth.

**Billing.** The result reports which backend answered: `backend` is `typesafe` or `command-code`, alongside the concrete response `model`, the `answers`, and token `usage`. Direct calls bill your TypeSafe account. Fallback calls consume the Command Code plan's model-specific credits or your pay-as-you-go credit balance. See the [Command Code Provider API](https://commandcode.ai/docs/provider) and the [GOAT plan](https://commandcode.ai/docs/plans/goat) for current rates — this README intentionally does not copy mutable prices.

**Privacy.** The tool never sends `x-cmd-zdr`, even when `CMD_ZDR=1` is set, because Command Code documents no ZDR-capable upstream for `typesafe/jev`. It does not provide an enforced-ZDR mode. A direct TypeSafe credential changes the preferred backend but does not disable Command Code fallback after retryable direct failures, and direct TypeSafe handling is governed by your TypeSafe agreement rather than `CMD_ZDR`. If your policy requires ZDR, do not send that data through this tool unless that agreement independently satisfies the requirement and Command Code fallback authentication is unavailable.

## Known Limits

- **Key matching.** The provider code passes the corresponding environment-variable reference (`$MINIMAX_API_KEY`, `$MINIMAX_CN_API_KEY`, `$STEP_API_KEY`) to Pi. If the variable is unset, the provider cannot authenticate.
- **MiniMax tool-call hardening.** The `minimax-openai` and `minimax-openai-cn` providers wrap their streams with a MiniMax-specific pipeline that folds inline `think` blocks into a proper `thinking` content block, repairs empty `{}` tool-call arguments via second-chance JSON parse, reorders tool-result messages to match the order of preceding `tool_use` blocks (the MiniMax API rejects mismatched ordering), and fails closed with a retryable error if the upstream ever emits internal tool-call markup instead of proper OpenAI tool calls.
- **StepFun native stream.** StepFun uses Pi's built-in OpenAI-compatible driver directly, without the MiniMax hardening pipeline.
- **Command Code catalog.** The 82 bundled models captured on 2026-09-27 are the fallback baseline. A successful live catalog response is authoritative for exposed model IDs, so bundled models missing from that response stay hidden until a later live refresh includes them. Pi persists the last successful catalog and restores it offline; online checks run at most every four hours unless forced. Refreshing requires `CMD_API_KEY`; on the first run, or after a refresh failure, Pi keeps showing the bundled or prior catalog until a successful refresh completes. Routing is declared per record: a model advertising `/messages` uses Anthropic Messages, otherwise `/chat/completions` uses OpenAI Chat Completions. Records that advertise only `/responses` are filtered out of the exposed catalog, because this package does not implement Responses API transport. Prices are dated estimates in USD per 1M tokens. Temporary offers use the rates advertised on 2026-09-27 and may change or expire; explicit free model IDs are zero in this snapshot and must be refreshed when their offers expire or the IDs leave the live catalog. DeepSeek V4 uses the displayed off-peak estimate because Pi cannot represent UTC price bands, and its peak input/output rates are higher. Open-model routing and ZDR can also change the actual charge; Command's usage page remains authoritative. `CMD_ZDR=1` applies only when making requests and is never persisted in the model cache.
- **Deeply nested tool schemas.** The MiniMax API may produce collapsed nested arguments on complex JSON schemas; this has been observed with `MiniMax-M3`. The package emits a diagnostic message instead of retrying.

## Development And Verification

```bash
pnpm install
pnpm check
pnpm pack:dry-run
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT. See [`LICENSE`](LICENSE).

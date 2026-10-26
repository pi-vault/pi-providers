# @pi-vault/pi-providers

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-providers)](https://www.npmjs.com/package/@pi-vault/pi-providers)
[![Quality](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-providers/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Register [MiniMax M3 and M3.1 Flash](https://www.minimax.io/), [StepFun Flash](https://stepfun.ai/), and [Command Code](https://commandcode.ai/) models as custom providers for [Pi](https://github.com/earendil-works/pi), and add a `typesafe_decide` tool for typed decision questions answered by [TypeSafe](https://typesafe.ai/) Jev. Command Code requires Pi 0.86 or newer.

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

# Optional secondary Command Code key name (CMD_API_KEY takes precedence)
export COMMAND_CODE_API_KEY="..."

# Optional: direct TypeSafe credential for typesafe_decide (preferred)
export TYPESAFE_API_KEY="..."

# Optional: enforce zero data retention for Command Code chat-provider requests only; excludes typesafe_decide
export CMD_ZDR=1

# Optional: override the live catalog endpoint only (inference bases stay unchanged)
export CMD_MODELS_URL="https://catalog.example.test/models"
```

You can also save a Command Code credential through Pi's login flow:

```text
/login command-code
```

`CMD_API_KEY` is the primary environment variable; `COMMAND_CODE_API_KEY` is a secondary alias. `CMD_MODELS_URL` changes only where the live model catalog is fetched, never where inference requests are sent.

After reloading, the providers appear in Pi's model picker:

- Select `minimax-openai` (or `minimax-openai-cn`) and choose `MiniMax-M3.1-Flash` or `MiniMax-M3`.
- Select `stepfun-ai` and choose one of `step-3.7-flash`, `step-3.5-flash-2603`, or `step-3.5-flash`.
- Select `command-code` and choose any bundled Command Code model.

Ask Pi normally; there is no provider-specific prompt syntax. Image input works with `MiniMax-M3.1-Flash`, `MiniMax-M3`, `step-3.7-flash`, and `command-code` models such as `minimax/minimax-m3.1-flash`.

The Command Code provider uses the [Provider API](https://commandcode.ai/docs/provider). GOAT membership can use the same API, but access and usage limits follow the current [GOAT plan](https://commandcode.ai/docs/plans/goat) and [pricing and limits](https://commandcode.ai/docs/resources/pricing-limits). This package does not calculate subscription entitlements or included credits.

`typesafe_decide` is a tool, not a selectable chat model, so it never appears in the model picker and never accepts a chat prompt. Pi calls it like any other tool — see [TypeSafe Decisions](#typesafe-decisions).

## What's New In 0.5.0

- **Authenticated MiniMax availability discovery** — both direct providers query their regional `/models` endpoint and keep only supported curated IDs. A successful empty result hides all direct models, the last successful catalog restores offline, and failures retain the prior catalog for retry. Regions use separate credentials and caches.
- **Direct MiniMax M3.1 Flash and refreshed M3 metadata** — both regional providers now expose `MiniMax-M3.1-Flash` first and `MiniMax-M3` second, with 1,000,000-token context, a 524,288-token output ceiling through `max_completion_tokens`, standard pricing, and image input. M3 pricing doubles above 512,000 input tokens. `MiniMax-M2.7` and `MiniMax-M2.7-highspeed` are removed from these direct providers only.
- **Reasoning continuity across tool rounds** — native `reasoning_content` keeps its exact whitespace and signature, interleaved thinking and text stay in arrival order, and unsigned thinking from saved same-model sessions is replayed as ordered `<think>` text for the next request.
- **Flash effort controls** — `MiniMax-M3.1-Flash` exposes `low`, `medium`, `high`, `xhigh`, and `max`. Omitting effort sends no field and uses upstream's default; the simple path clamps `minimal` to `low`. M3 keeps automatic thinking.
- **Refreshed Command Code catalog** — 93 bundled models captured 2026-10-25, with updated capabilities and dated prices, including paid Ling pricing distinct from retired free aliases.
- **TypeSafe question compatibility and gateway limits** — optional or null instructions, criteria-only Noul questions, nullable Choice descriptions, and one-option Choice or one-level Score questions are accepted. Command Code requests enforce the 100-question limit before sending; direct TypeSafe requests keep their upstream limits.

See [`CHANGELOG.md`](CHANGELOG.md) for the full release notes, including reasoning replay and catalog refresh fixes.

## What's New In 0.4.1

- **`COMMAND_CODE_API_KEY` alias and catalog-only `CMD_MODELS_URL` override** — `CMD_API_KEY` keeps precedence; `CMD_MODELS_URL` changes only where the live model catalog is fetched, never where inference requests are sent. Inference bases are unchanged.
- **Live `pricing`, `modalities`, and `reasoning` metadata with strict catalog validation** — valid live fields override local estimates; missing fields fall back to Pi donor metadata, official family defaults, or the dated bundled pricing snapshot. Malformed refreshes retain the prior catalog.
- **Official family and adaptive-thinking fallbacks** — retained alongside the bundled snapshot and offline cache. Pricing for temporary offers uses the rates advertised on 2026-09-30.
- **Command Code output-cap and cache migration** — default max output raised to 32,768 capped by each model's context window. Legacy cache records are migrated in place.
- **OpenAI Responses routing** — supported alongside Anthropic Messages and OpenAI Chat Completions. Records advertising only `/responses` no longer get filtered out.
- **86-model bundled snapshot** — captured 2026-09-30 (was 82). See [`CHANGELOG.md`](CHANGELOG.md) for the full release notes.

## What's New In 0.4.0

- **`typesafe_decide` tool** (new) — answers typed Noul, Choice, and Score questions against a JSON `state` with TypeSafe Jev and returns structured probabilities, not generated text. Calls TypeSafe System One directly when a `TYPESAFE_API_KEY` or host-resolved `typesafe` credential is present; otherwise makes a single fallback request to `typesafe/jev` through `command-code`. Direct `400` / `422` responses and cancellation are terminal and never fall back. System One requests never inherit `CMD_ZDR`, because `typesafe/jev` has no ZDR-capable Command Code upstream — the tool provides no enforced-ZDR mode.
- **Command Code catalog refreshed to 82 models** — snapshot captured 2026-09-27 (was 62). Routing is declared per record: `/messages` takes precedence, `/chat/completions` is used otherwise, and records advertising only `/responses` are filtered out because this package does not implement Responses API transport. Pricing estimates were also refreshed against the 2026-09-27 rates. See [`CHANGELOG.md`](CHANGELOG.md) for the full release notes.

## Providers And Models

| Provider                               | Model                                            | Input       | Reasoning                 | Context   | Max output                 | Input / output per 1M tokens | Cache read |
| -------------------------------------- | ------------------------------------------------ | ----------- | ------------------------- | --------- | -------------------------- | ---------------------------- | ---------- |
| `minimax-openai` / `minimax-openai-cn` | `MiniMax-M3.1-Flash`                             | text, image | low / medium / high / xhigh / max | 1,000,000 | 524,288                    | $0.15 / $0.60                | $0.015     |
| `minimax-openai` / `minimax-openai-cn` | `MiniMax-M3`                                     | text, image | automatic                 | 1,000,000 | 524,288                    | $0.30 / $1.20                | $0.06      |
| `stepfun-ai`                           | `step-3.7-flash`                                 | text, image | low / medium / high       | 256,000   | 256,000                    | $0.20 / $1.15                | $0.04      |
| `stepfun-ai`                           | `step-3.5-flash-2603`                            | text        | low / high                | 256,000   | 256,000                    | $0.10 / $0.30                | $0.02      |
| `stepfun-ai`                           | `step-3.5-flash`                                 | text        | automatic (shown as high) | 256,000   | 256,000                    | $0.10 / $0.30                | $0.02      |
| `command-code`                         | 93 bundled snapshot models (captured 2026-10-25) | varies      | varies                    | varies    | up to min(32,768, context) | varies                       | varies     |
| `command-code`                         | `minimax/minimax-m3.1-flash`                     | text, image | low / medium / high / xhigh / max | 1,000,000 | up to min(32,768, context) | $0.15 / $0.60                | $0.015     |

API bases:

- `minimax-openai`: `https://api.minimax.io/v1`
- `minimax-openai-cn`: `https://api.minimaxi.com/v1`
- `stepfun-ai`: `https://api.stepfun.ai/step_plan/v1`
- `command-code`: `https://api.commandcode.ai/provider/v1`

Direct MiniMax models use standard service pricing. `MiniMax-M3` doubles to $0.60 / $2.40 / $0.12 per 1M input / output / cache-read tokens above 512,000 input tokens. Both models cap output at 524,288 tokens within the 1,000,000-token context and send `max_completion_tokens`. Cache writes are free for both direct MiniMax models and for all `stepfun-ai` models.

`MiniMax-M3.1-Flash` exposes the five supported thinking efforts: `low`, `medium`, `high`, `xhigh`, and `max`. Omitting effort sends no `reasoning_effort` field and preserves upstream's maximum default. On the simple provider path, `minimal` clamps to `low`. `MiniMax-M3` keeps automatic thinking without an effort or disable control. `MiniMax-M2.7` and `MiniMax-M2.7-highspeed` are no longer bundled by the direct providers; historical changelog entries remain.

**Availability discovery.** Both direct MiniMax providers require the regional API key before querying `${baseUrl}/models`. The initial catalog is the curated two-model baseline. A validated response filters availability to curated IDs in curated order: IDs that are not part of the supported catalog are ignored, and a successful response with no supported IDs authoritatively hides every direct MiniMax model. New upstream IDs appear only after this package adds their curated metadata. Pi persists successful results per provider and restores that subset or empty result offline, so global and China caches never cross. Successful checks stay fresh for four hours; failures keep the prior catalog and remain retryable without writing a failed-check timestamp. An SDK caller can force an online check with `ModelRuntime.refresh({ providers: ["minimax-openai"], allowNetwork: true, force: true })` (or `minimax-openai-cn`). China `/v1/models` parity is assumed but has not been verified against a live authenticated endpoint; a failure in one region leaves the other region unchanged.

## TypeSafe Decisions

`typesafe_decide` is a Pi tool, not a chat model. It takes a JSON `state` plus one or more named questions and returns **structured probabilities**, not generated text:

- **Noul** — a yes/no question. `instructions` is optional and may be null. When `instructions` is omitted or null, at least one of `criteria.true` / `criteria.false` must be a non-null description.
- **Choice** — a question over 1–255 named options, each with a string, object, array, or null rubric description.
- **Score** — a question over 1–10 ordered level descriptions; Score levels cannot be null.

`instructions` and rubric descriptions accept a string, JSON object, or JSON array, and `instructions` may also be null. Omitted fields stay omitted rather than becoming empty strings, and explicit null stays null. A one-option Choice or one-level Score is valid; a one-level Score answer uses score `0` and probabilities `{ "0": 1 }`.

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

Add a criteria-only Noul, an explicit-null Noul, a one-option Choice, and a one-level Score:

```json
{
  "state": { "ticket": "payouts failing for three days" },
  "questions": {
    "ready_to_ship": {
      "type": "noul",
      "criteria": { "true": "All release gates pass" }
    },
    "blocked": {
      "type": "noul",
      "instructions": null,
      "criteria": { "false": "No blocker", "true": "Blocked" }
    },
    "next_step": { "type": "choice", "criteria": { "ship": null } },
    "risk": { "type": "score", "criteria": ["Low"] }
  }
}
```

**Routing.** The tool prefers direct TypeSafe access: with a configured credential it calls `jev-latest` on the TypeSafe System One API. If no direct credential is available, or a direct attempt fails in a retryable way, it may make a single fallback request to `typesafe/jev` through Command Code. Direct `400` / `404` / `413` / `415` / `422` responses mean the request itself is invalid, and a cancelled call is terminal — none fall back. Direct `401` / `403` / `429` / `529`, other `5xx`, transport failures, timeouts, and malformed success responses are eligible for one backend failover. Credentials are resolved in this order: a host-resolved `typesafe` credential, then a non-blank `TYPESAFE_API_KEY`, then `command-code` fallback auth.

**Question limits.** Direct TypeSafe requests have no fixed local question cap; upstream token budgets remain authoritative, normally 64K tokens across state plus all questions and 32K across state plus any individual question. Command Code System One accepts at most 100 questions per request. Both gateway paths — an initial request with no direct credential and a retryable fallback after a direct failure — enforce that limit before resolving Command Code credentials or sending. A direct request with 101 or more questions can still succeed. If such an oversized direct request fails retryably, the tool reports the sanitized direct failure together with the gateway limit and never splits, truncates, or forwards the batch.

**Billing.** The result reports which backend answered: `backend` is `typesafe` or `command-code`, alongside the concrete response `model`, the `answers`, and token `usage`. Direct calls bill your TypeSafe account. Fallback calls consume the Command Code plan's model-specific credits or your pay-as-you-go credit balance. See the [Command Code Provider API](https://commandcode.ai/docs/provider) and the [GOAT plan](https://commandcode.ai/docs/plans/goat) for current rates — this README intentionally does not copy mutable prices.

**Privacy.** The tool never sends `x-cmd-zdr`, even when `CMD_ZDR=1` is set, because Command Code documents no ZDR-capable upstream for `typesafe/jev`. It does not provide an enforced-ZDR mode. A direct TypeSafe credential changes the preferred backend but does not disable Command Code fallback after retryable direct failures, and direct TypeSafe handling is governed by your TypeSafe agreement rather than `CMD_ZDR`. If your policy requires ZDR, do not send that data through this tool unless that agreement independently satisfies the requirement and Command Code fallback authentication is unavailable.

## Known Limits

- **Key matching.** The provider code passes the corresponding environment-variable reference (`$MINIMAX_API_KEY`, `$MINIMAX_CN_API_KEY`, `$STEP_API_KEY`) to Pi. If the variable is unset, the provider cannot authenticate.
- **MiniMax tool-call hardening.** The `minimax-openai` and `minimax-openai-cn` providers wrap their streams with a MiniMax-specific pipeline that folds inline `think` blocks into a proper `thinking` content block, repairs empty `{}` tool-call arguments via second-chance JSON parse, reorders tool-result messages to match the order of preceding `tool_use` blocks (the MiniMax API rejects mismatched ordering), and fails closed with a retryable error if the upstream ever emits internal tool-call markup instead of proper OpenAI tool calls.
- **MiniMax reasoning replay.** Native `reasoning_content` stays a signed thinking block with its exact whitespace, and interleaved thinking/text/tool segments keep their arrival order across a tool round trip. Before a same-model request, unsigned thinking from older saved sessions is replayed as ordered `<think>…</think>` text without changing the stored transcript; signed and foreign history are left to Pi's serializer. No payload rewriting is added.
- **StepFun native stream.** StepFun uses Pi's built-in OpenAI-compatible driver directly, without the MiniMax hardening pipeline.
- **Command Code catalog.** The 93 bundled models captured on 2026-10-25 are the fallback baseline, with a default max output of 32,768 capped by each model's context window. A successful live catalog response is authoritative for exposed model IDs, so bundled models missing from that response stay hidden until a later live refresh includes them. Valid live `pricing`, `modalities`, and `reasoning` metadata overrides local estimates; missing fields fall back to dated local capabilities for the verified additions, then to Pi donor metadata, official family defaults, or the dated bundled pricing snapshot. Pi persists the last successful catalog and restores it offline; source-aware online checks run at most every four hours unless forced, and changing `CMD_MODELS_URL` triggers a refresh. Refreshing requires Command Code authentication; on the first run, or after a refresh failure, Pi keeps showing the bundled or prior catalog until a successful refresh completes. Routing is declared per record: `/messages` uses Anthropic Messages, `/responses` uses OpenAI Responses, and `/chat/completions` uses OpenAI Chat Completions. Prices are dated estimates in USD per 1M tokens. Temporary offers use the rates advertised on 2026-10-25 and may change or expire; the explicit free model IDs are zero in this snapshot and must be refreshed when their offers expire or the IDs leave the live catalog. Paid `inclusionai/ling-3.1-flash` is separate from the retired free Ling aliases and keeps its paid rates. DeepSeek V4 uses the displayed off-peak estimate because Pi cannot represent UTC price bands, and its peak input/output rates are higher. Open-model routing and ZDR can also change the actual charge; Command's usage page remains authoritative. `CMD_ZDR=1` applies only when making requests and is never persisted in the model cache.
- **Command Code Flash effort.** `minimax/minimax-m3.1-flash` accepts text and image input and exposes the five supported thinking efforts: `low`, `medium`, `high`, `xhigh`, and `max`. `minimal` is clamped to `low` on the simple provider path, and omitting effort sends no `reasoning_effort`, preserving upstream's default. The gateway still caps output at 32,768 tokens unless the live catalog advertises a smaller or larger explicit supported limit capped by context.
- **Deeply nested tool schemas.** The MiniMax API may produce collapsed nested arguments on complex JSON schemas; this has been observed with `MiniMax-M3`. The package emits a diagnostic message instead of retrying.

## Development And Verification

Development uses Pi `0.87.1` as its compatibility baseline. Tooling updates are checked against npm publication timestamps and must be at least 48 hours old; this release uses Biome `2.6.2` because `2.6.3` was newer than that cutoff. Pi `1.4.0` requires model-union and tool-context type migration and is deferred.

```bash
pnpm install
pnpm check
pnpm pack:dry-run
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT. See [`LICENSE`](LICENSE).

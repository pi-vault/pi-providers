# Command Code Registration Consistency Design

## Problem

`src/index.ts` registers MiniMax and StepFun through provider-specific
`registerX(pi)` helpers, but registers Command Code inline with
`pi.registerProvider(createCommandCodeProvider())`. Pi supports both native
provider objects and config registrations, so the current code works, but the
extension entry point has an inconsistent shape.

## Goal

Give Command Code the same registration boundary as the other providers
without changing its native provider lifecycle or runtime behavior.

## Decision

Add `registerCommandCode(pi)` next to `createCommandCodeProvider()` in
`src/providers/command-code.ts`. The helper calls:

```ts
pi.registerProvider(createCommandCodeProvider());
```

Update `src/index.ts` to import `registerCommandCode` and call it after
`registerStepFun(pi)`. The existing factory remains available for direct
provider tests and callers that need the native `Provider` object.

## Runtime behavior

The helper is an adapter only. Command Code continues to use Pi's native
provider registration path, including:

- static baseline models plus the live catalog overlay;
- Pi-managed restore, publication, persistence, and refresh errors;
- four-hour non-forced refresh throttling and retained catalogs on failure;
- mixed Anthropic Messages/OpenAI Completions routing; and
- provider-instance ZDR headers that are not persisted in the model cache.

No config-style registration conversion, duplicate model catalog, startup
listener, or new dependency is introduced.

## Testing

Add a focused `registerCommandCode` test that supplies a mocked
`registerProvider`, asserts one call, and verifies the registered native
provider has the `command-code` ID. Keep the existing factory, live-catalog,
ZDR, and cancellation tests unchanged. The extension registration test must
continue to verify the four-provider order:

1. `minimax-openai`
2. `minimax-openai-cn`
3. `stepfun-ai`
4. `command-code`

Run the focused provider and extension tests, then the full `pnpm check` under
Node 24.15.0. Package verification must continue to include `src/index.ts`
and the Command Code provider source.

## Acceptance criteria

- `src/index.ts` calls `registerCommandCode(pi)` rather than constructing the
  Command Code provider inline.
- `registerCommandCode(pi)` registers exactly one native provider with ID
  `command-code`.
- Existing live catalog, persistence, refresh, routing, ZDR, and cancellation
  behavior is unchanged.
- Focused tests, full project checks, and package verification pass.

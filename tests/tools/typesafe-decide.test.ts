// tests/tools/typesafe-decide.test.ts

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTypeSafeDecisionTool } from "../../src/tools/typesafe-decide.ts";

const DIRECT_URL = "https://api.typesafe.ai/v1/systemone";
const FALLBACK_URL = "https://api.commandcode.ai/provider/v1/systemone";

const DIRECT_KEY = "direct-key";
const FALLBACK_KEY = "command-key";

const state = "Help! My payouts have been failing for 3 days.";

const questions = {
  is_urgent: {
    type: "noul",
    instructions: "Does this convey urgency?",
    criteria: { true: "Explicitly time-sensitive", false: "No urgency expressed" },
  },
  department: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: { billing: "Payments and refunds", technical: "Bugs and outages" },
  },
  frustration: {
    type: "score",
    instructions: "How frustrated is the customer?",
    criteria: ["Calm", "Frustrated", "Very angry"],
  },
} as const;

const successBody = {
  model: "jev-1.13.0",
  answers: {
    is_urgent: { type: "noul", noul: 0.95 },
    department: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.88, technical: 0.12 },
      confidence: 0.81,
    },
    frustration: {
      type: "score",
      score: 1.05,
      legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      probabilities: { "0": 0.0, "1": 0.95, "2": 0.05 },
      confidence: 0.92,
    },
  },
  usage: { input_tokens: 392, output_tokens: 65 },
};

type ToolDetails = {
  backend: "typesafe" | "command-code";
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
};

type Captured = ToolDefinition<any, ToolDetails, any>;

interface HarnessOptions {
  typesafeKey?: string | undefined;
  commandKey?: string | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createHarness(options: HarnessOptions = {}) {
  const registerTool = vi.fn();
  const pi = { registerTool } as unknown as ExtensionAPI;
  registerTypeSafeDecisionTool(pi);

  const getApiKeyForProvider = vi.fn(async (provider: string) =>
    provider === "typesafe"
      ? options.typesafeKey
      : provider === "command-code"
        ? options.commandKey
        : undefined,
  );
  const ctx = { modelRegistry: { getApiKeyForProvider } } as unknown as ExtensionContext;

  return { tool: registerTool.mock.calls[0]?.[0] as Captured, getApiKeyForProvider, ctx };
}

function installFetch(handlers: Array<(request: Request) => Response | Promise<Response>>) {
  const requests: Request[] = [];
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const handler = handlers[requests.length - 1];
    if (!handler) throw new Error(`Unexpected fetch #${requests.length}: ${request.url}`);
    return handler(request);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

function callTool(
  harness: ReturnType<typeof createHarness>,
  params: unknown,
  signal?: AbortSignal,
): Promise<{ content: { type: string; text: string }[]; details: ToolDetails; usage?: unknown }> {
  return harness.tool.execute("tc_1", params, signal, undefined, harness.ctx) as never;
}

beforeEach(() => {
  vi.stubEnv("TYPESAFE_API_KEY", undefined);
  vi.stubEnv("CMD_ZDR", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("TypeSafe decide schema and preflight", () => {
  it("exposes TypeBox cardinality constraints in the parameter schema", () => {
    const { tool } = createHarness();
    const schema = tool.parameters as any;
    const variants = schema.properties.questions.additionalProperties.anyOf;

    expect(schema.properties.questions.minProperties).toBe(1);
    expect(variants[0].properties.criteria.required).toBeUndefined();
    expect(variants[1].properties.criteria.minProperties).toBe(2);
    expect(variants[1].properties.criteria.maxProperties).toBe(255);
    expect(variants[2].properties.criteria.minItems).toBe(2);
    expect(variants[2].properties.criteria.maxItems).toBe(10);
  });

  it("rejects an empty question map without fetching", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { requests, fetchMock } = installFetch([() => jsonResponse(successBody)]);

    await expect(callTool(harness, { state, questions: {} })).rejects.toThrow(
      /at least one question/i,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it("accepts Noul, Choice, and Score questions in one request", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    installFetch([() => jsonResponse(successBody)]);

    const result = await callTool(harness, { state, questions });

    expect(result.details.backend).toBe("typesafe");
    expect(Object.keys(result.details.answers).sort()).toEqual([
      "department",
      "frustration",
      "is_urgent",
    ]);
  });

  it("rejects Choice criteria outside 2–255 options without fetching", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

    await expect(
      callTool(harness, {
        state,
        questions: {
          department: {
            type: "choice",
            instructions: "Which team?",
            criteria: { billing: "Payments" },
          },
        },
      }),
    ).rejects.toThrow(/between 2 and 255 options/i);

    await expect(
      callTool(harness, {
        state,
        questions: {
          department: {
            type: "choice",
            instructions: "Which team?",
            criteria: Object.fromEntries(
              Array.from({ length: 256 }, (_, i) => [`option_${i}`, "rubric"]),
            ),
          },
        },
      }),
    ).rejects.toThrow(/between 2 and 255 options/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it("rejects Score criteria outside 2–10 levels without fetching", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

    await expect(
      callTool(harness, {
        state,
        questions: {
          frustration: { type: "score", instructions: "How frustrated?", criteria: ["Calm"] },
        },
      }),
    ).rejects.toThrow(/between 2 and 10 levels/i);

    await expect(
      callTool(harness, {
        state,
        questions: {
          frustration: {
            type: "score",
            instructions: "How frustrated?",
            criteria: Array.from({ length: 11 }, (_, i) => `level ${i}`),
          },
        },
      }),
    ).rejects.toThrow(/between 2 and 10 levels/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it("preserves prototype-sensitive question IDs", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { requests } = installFetch([
      () =>
        jsonResponse(
          JSON.parse(
            `{"model": "jev-1.13.0", "answers": {"__proto__": {"type": "noul", "noul": 0.4}, "toString": {"type": "noul", "noul": 0.6}}, "usage": {"input_tokens": 10, "output_tokens": 2}}`,
          ),
        ),
    ]);

    const sensitive = JSON.parse(
      `{"__proto__": {"type": "noul", "instructions": "Is the payload hostile?"}, "toString": {"type": "noul", "instructions": "Is the payload a string?"}}`,
    ) as Record<string, unknown>;

    const result = await callTool(harness, { state, questions: sensitive });

    const sent = (await requests[0]?.json()) as { questions: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(sent.questions, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(sent.questions, "toString")).toBe(true);
    expect(sent.questions.__proto__).toEqual(sensitive.__proto__);

    const answers = result.details.answers;
    expect(Object.prototype.hasOwnProperty.call(answers, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(answers, "toString")).toBe(true);
    expect(answers.__proto__).toEqual({ type: "noul", noul: 0.4 });
    expect(JSON.parse(result.content[0]?.text ?? "{}").answers.__proto__).toEqual({
      type: "noul",
      noul: 0.4,
    });
  });
});

describe("TypeSafe decide direct request", () => {
  it("uses registered TypeSafe auth before TYPESAFE_API_KEY", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "env-key");
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { requests } = installFetch([() => jsonResponse(successBody)]);

    await callTool(harness, { state, questions });

    expect(harness.getApiKeyForProvider).toHaveBeenCalledWith("typesafe");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer direct-key");
  });

  it("uses TYPESAFE_API_KEY when the host has no TypeSafe provider", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "env-key");
    const harness = createHarness({ typesafeKey: undefined });
    const { requests } = installFetch([() => jsonResponse(successBody)]);

    await callTool(harness, { state, questions });

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer env-key");
  });

  it("serializes jev-latest and TypeSafe-native questions", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { requests } = installFetch([() => jsonResponse(successBody)]);

    await callTool(harness, { state, questions });

    const request = requests[0];
    expect(request?.url).toBe(DIRECT_URL);
    expect(request?.headers.get("authorization")).toBe("Bearer direct-key");
    expect(request?.headers.has("x-cmd-zdr")).toBe(false);
    expect(await request?.json()).toEqual({ state, model: "jev-latest", questions });
  });

  it("returns backend, concrete model, answers, raw usage, and Pi usage", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    installFetch([() => jsonResponse(successBody)]);

    const result = await callTool(harness, { state, questions });

    expect(result.details).toEqual({
      backend: "typesafe",
      model: "jev-1.13.0",
      answers: successBody.answers,
      usage: { input_tokens: 392, output_tokens: 65 },
    });
    expect(result.usage).toEqual({
      input: 392,
      output: 65,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 457,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toBe(JSON.stringify(result.details));
  });

  it("never sends x-cmd-zdr", async () => {
    vi.stubEnv("CMD_ZDR", "1");
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => new Response("nope", { status: 500 }),
      () => jsonResponse(successBody),
    ]);

    await callTool(harness, { state, questions });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.has("x-cmd-zdr")).toBe(false);
    }
  });
});

describe("TypeSafe decide fallback policy", () => {
  it("falls back when direct credentials are missing", async () => {
    const harness = createHarness({ typesafeKey: undefined, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([() => jsonResponse(successBody)]);

    const result = await callTool(harness, { state, questions });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(FALLBACK_URL);
    expect(result.details.backend).toBe("command-code");
  });

  it.each([
    ["401", 401],
    ["403", 403],
    ["429", 429],
    ["529", 529],
    ["500", 500],
    ["503", 503],
  ])("falls back exactly once on direct %s", async (_label, status) => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => new Response(JSON.stringify({ error: "upstream" }), { status }),
      () => jsonResponse(successBody),
    ]);

    const result = await callTool(harness, { state, questions });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(DIRECT_URL);
    expect(requests[1]?.url).toBe(FALLBACK_URL);
    expect(result.details.backend).toBe("command-code");
  });

  it("falls back exactly once on a direct transport failure", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => {
        throw new TypeError("fetch failed");
      },
      () => jsonResponse(successBody),
    ]);

    const result = await callTool(harness, { state, questions });

    expect(requests).toHaveLength(2);
    expect(result.details.backend).toBe("command-code");
  });

  it("falls back exactly once on a direct timeout", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => {
        throw Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
      },
      () => jsonResponse(successBody),
    ]);

    const result = await callTool(harness, { state, questions });

    expect(requests).toHaveLength(2);
    expect(result.details.backend).toBe("command-code");
  });

  it("falls back exactly once on a malformed direct 200", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => jsonResponse({ model: 42, answers: "nope", usage: { input_tokens: "many" } }),
      () => jsonResponse(successBody),
    ]);

    const result = await callTool(harness, { state, questions });

    expect(requests).toHaveLength(2);
    expect(result.details.backend).toBe("command-code");
  });

  it.each([
    ["400", 400],
    ["422", 422],
  ])("treats direct %s as terminal without a second billable request", async (_label, status) => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => new Response(JSON.stringify({ error: "invalid question" }), { status }),
      () => jsonResponse(successBody),
    ]);

    const error = await callTool(harness, { state, questions }).catch((cause: Error) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(new RegExp(`status ${status}`));
    expect((error as Error).message).not.toMatch(/command-?code/i);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(DIRECT_URL);
  });

  it("treats caller cancellation as terminal and does not fall back", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const controller = new AbortController();
    const { requests } = installFetch([
      () => {
        controller.abort();
        return Promise.reject(
          Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
        );
      },
      () => jsonResponse(successBody),
    ]);

    const error = await callTool(harness, { state, questions }, controller.signal).catch(
      (cause: Error) => cause,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/cancel/i);
    expect((error as Error).message).not.toMatch(/timed out|timeout/i);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(DIRECT_URL);
  });

  it("fails before fetching when neither backend has credentials", async () => {
    const harness = createHarness({ typesafeKey: undefined, commandKey: undefined });
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

    await expect(callTool(harness, { state, questions })).rejects.toThrow(
      /no TypeSafe or Command Code credentials/i,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses typesafe/jev, Command Code auth, and no x-cmd-zdr on fallback", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => new Response("boom", { status: 500 }),
      () => jsonResponse(successBody),
    ]);

    await callTool(harness, { state, questions });

    const request = requests[1];
    expect(request?.url).toBe(FALLBACK_URL);
    expect(request?.headers.get("authorization")).toBe(`Bearer ${FALLBACK_KEY}`);
    expect(request?.headers.has("x-cmd-zdr")).toBe(false);
    expect(await request?.json()).toEqual({ state, model: "typesafe/jev", questions });
  });

  it("reports a sanitized failure when the fallback also fails", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    installFetch([
      () => new Response("direct exploded", { status: 500 }),
      () =>
        new Response(JSON.stringify({ error: `leaked ${DIRECT_KEY} and ${FALLBACK_KEY}` }), {
          status: 502,
        }),
    ]);

    const error = (await callTool(harness, { state, questions }).catch(
      (cause: Error) => cause,
    )) as Error;

    expect(error.message).toMatch(/Command Code/);
    expect(error.message).toMatch(/502/);
    expect(error.message).not.toContain(DIRECT_KEY);
    expect(error.message).not.toContain(FALLBACK_KEY);
    expect(error.message).not.toContain("exploded");
  });
});

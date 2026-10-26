// tests/tools/typesafe-decide.test.ts

import { validateToolArguments } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DecideParams,
  registerTypeSafeDecisionTool,
} from "../../src/tools/typesafe-decide.ts";

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

type Captured = ToolDefinition<TSchema, ToolDetails, unknown>;

const own = (value: Record<string, unknown>, key: string) =>
  Object.getOwnPropertyDescriptor(value, key)?.value;

type ParametersSchema = {
  properties: {
    questions: {
      minProperties: number;
      additionalProperties: {
        anyOf: QuestionVariant[];
      };
    };
  };
};

type QuestionVariant = {
  properties: {
    type: { const?: string };
    criteria: {
      required?: string[];
      minProperties?: number;
      maxProperties?: number;
      minItems?: number;
      maxItems?: number;
    };
  };
};

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
  const ctx = { modelRegistry: { getApiKeyForProvider } } as unknown as ExtensionToolContext;

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

function callValidatedTool(
  harness: ReturnType<typeof createHarness>,
  params: unknown,
  signal?: AbortSignal,
): ReturnType<typeof callTool> {
  const validated = validateToolArguments(harness.tool as never, {
    type: "toolCall",
    id: "tc_validated",
    name: "typesafe_decide",
    arguments: params as never,
  });
  return callTool(harness, validated, signal);
}

function rawSchemaAccepts(harness: ReturnType<typeof createHarness>, params: unknown): boolean {
  return Compile(harness.tool.parameters as TSchema).Check(params);
}

function answerForQuestion(question: unknown): Record<string, unknown> {
  const typed = question as { type: string; criteria?: unknown };
  if (typed.type === "noul") return { type: "noul", noul: 0.5 };
  if (typed.type === "choice") {
    const options = Object.getOwnPropertyNames(typed.criteria as object);
    return {
      type: "choice",
      choice: options[0],
      confidence: 1,
      probabilities: Object.fromEntries(
        options.map((option, index) => [option, index === 0 ? 1 : 0]),
      ),
    };
  }
  const levels = (typed.criteria as unknown[]).map((_, index) => String(index));
  return {
    type: "score",
    score: 0,
    confidence: 1,
    legend: Object.fromEntries(
      levels.map((level, index) => [level, (typed.criteria as unknown[])[index]]),
    ),
    probabilities: Object.fromEntries(levels.map((level, index) => [level, index === 0 ? 1 : 0])),
  };
}

function answersFor(questions: Record<string, unknown>): Record<string, unknown> {
  const answers = Object.create(null) as Record<string, unknown>;
  for (const id of Object.getOwnPropertyNames(questions)) {
    answers[id] = answerForQuestion(questions[id]);
  }
  return answers;
}

function responseFor(questions: Record<string, unknown>, model: string) {
  return {
    model,
    answers: answersFor(questions),
    usage: { input_tokens: 11, output_tokens: 4 },
  };
}

function noulQuestions(count: number): Record<string, unknown> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `question_${index}`,
      { type: "noul", instructions: `Question ${index}?` },
    ]),
  );
}

async function runAccepted(
  options: HarnessOptions,
  model: string,
  questions: Record<string, unknown>,
  validated: boolean,
) {
  const harness = createHarness(options);
  const { requests } = installFetch([() => jsonResponse(responseFor(questions, model))]);
  const params = { state, questions };
  const result = validated
    ? await callValidatedTool(harness, params)
    : await callTool(harness, params);
  const sent = (await requests[0]?.json()) as { questions: Record<string, unknown> };
  return { harness, requests, result, sent };
}

const acceptedQuestions = {
  criteria_only: { type: "noul", criteria: { true: "Ready to ship" } },
  false_only: { type: "noul", instructions: null, criteria: { false: "Blocked", true: null } },
  true_only: { type: "noul", instructions: null, criteria: { true: "Ready to ship" } },
  instructions_only: { type: "noul", instructions: "Ready?" },
  null_criteria: { type: "noul", instructions: "Ready?", criteria: null },
  null_outcomes: { type: "noul", instructions: "Ready?", criteria: { true: null, false: null } },
  empty_criteria: { type: "noul", instructions: "Ready?", criteria: {} },
  single_choice: { type: "choice", criteria: { only: null } },
  choice_null_instructions: { type: "choice", instructions: null, criteria: { only: null } },
  single_score: { type: "score", instructions: null, criteria: ["Only level"] },
  score_omitted_instructions: { type: "score", criteria: ["Only level"] },
} satisfies DecideParams["questions"];

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
    const schema = tool.parameters as unknown as ParametersSchema;
    const variants = schema.properties.questions.additionalProperties.anyOf;
    const variant = (type: string) =>
      variants.find((item) => item.properties.type.const === type) as QuestionVariant;

    expect(schema.properties.questions.minProperties).toBe(1);
    expect(variant("noul").properties.criteria.required).toBeUndefined();
    expect(variant("choice").properties.criteria.minProperties).toBe(1);
    expect(variant("choice").properties.criteria.maxProperties).toBe(255);
    expect(variant("score").properties.criteria.minItems).toBe(1);
    expect(variant("score").properties.criteria.maxItems).toBe(10);
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

  it("accepts criteria-only questions through Pi validation", async () => {
    const subset = {
      criteria_only: acceptedQuestions.criteria_only,
      true_only: acceptedQuestions.true_only,
      instructions_only: acceptedQuestions.instructions_only,
    };
    const schemaHarness = createHarness();

    for (const options of [
      { typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY },
      { typesafeKey: undefined, commandKey: FALLBACK_KEY },
    ]) {
      const model = options.typesafeKey ? "jev-1.14.0" : "typesafe/jev";
      for (const [id, question] of Object.entries(subset)) {
        const questions = { [id]: question };
        expect(rawSchemaAccepts(schemaHarness, { state, questions })).toBe(true);

        for (const validated of [false, true]) {
          const { requests, result, sent } = await runAccepted(
            options,
            model,
            questions,
            validated,
          );
          expect(requests).toHaveLength(1);
          expect(sent.questions).toEqual(questions);
          expect(result.details.backend).toBe(options.typesafeKey ? "typesafe" : "command-code");
          expect(result.details.model).toBe(model);
        }
      }
    }

    const { sent } = await runAccepted(
      { typesafeKey: DIRECT_KEY },
      "jev-1.14.0",
      { criteria_only: acceptedQuestions.criteria_only },
      false,
    );
    expect(Object.hasOwn(sent.questions.criteria_only as object, "instructions")).toBe(false);

    const instructionsOnly = await runAccepted(
      { typesafeKey: DIRECT_KEY },
      "jev-1.14.0",
      { instructions_only: acceptedQuestions.instructions_only },
      true,
    );
    expect(
      Object.hasOwn(instructionsOnly.sent.questions.instructions_only as object, "criteria"),
    ).toBe(false);
  });

  it("preserves explicit null fields through Pi validation", async () => {
    const ids = [
      "false_only",
      "null_criteria",
      "null_outcomes",
      "empty_criteria",
      "single_choice",
      "choice_null_instructions",
      "single_score",
      "score_omitted_instructions",
    ] as const;
    const schemaHarness = createHarness();

    for (const options of [
      { typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY },
      { typesafeKey: undefined, commandKey: FALLBACK_KEY },
    ]) {
      const model = options.typesafeKey ? "jev-1.14.0" : "typesafe/jev";
      for (const id of ids) {
        const questions = { [id]: acceptedQuestions[id] };
        expect(rawSchemaAccepts(schemaHarness, { state, questions })).toBe(true);

        for (const validated of [false, true]) {
          const { result, sent } = await runAccepted(options, model, questions, validated);
          expect(sent.questions).toEqual(questions);
          expect(result.details.backend).toBe(options.typesafeKey ? "typesafe" : "command-code");

          if (id === "false_only") {
            const sentQuestion = sent.questions.false_only as {
              instructions: unknown;
              criteria: Record<string, unknown>;
            };
            expect(sentQuestion.instructions).toBeNull();
            expect(sentQuestion.criteria.true).toBeNull();
            expect(sentQuestion.criteria.false).toBe("Blocked");
          }
          if (id === "null_criteria") {
            expect((sent.questions.null_criteria as { criteria: unknown }).criteria).toBeNull();
          }
          if (id === "single_choice" || id === "choice_null_instructions") {
            expect(Object.hasOwn(sent.questions[id] as object, "instructions")).toBe(
              id === "choice_null_instructions",
            );
          }
          if (id === "score_omitted_instructions") {
            expect(
              Object.hasOwn(sent.questions.score_omitted_instructions as object, "instructions"),
            ).toBe(false);
          }
          if (id === "single_score") {
            expect(
              (sent.questions.single_score as { instructions: unknown }).instructions,
            ).toBeNull();
            expect(result.details.answers.single_score).toEqual({
              type: "score",
              score: 0,
              confidence: 1,
              legend: { "0": "Only level" },
              probabilities: { "0": 1 },
            });
          }
          if (id === "single_choice") {
            expect(result.details.answers.single_choice).toMatchObject({
              choice: "only",
              probabilities: { only: 1 },
            });
          }
        }
      }
    }
  });

  it("requires a non-null Noul description without instructions", async () => {
    const invalidNouls = [
      { type: "noul" },
      { type: "noul", instructions: null },
      { type: "noul", instructions: null, criteria: null },
      { type: "noul", instructions: null, criteria: {} },
      { type: "noul", instructions: null, criteria: { true: null } },
      { type: "noul", instructions: null, criteria: { false: null } },
      { type: "noul", instructions: null, criteria: { true: null, false: null } },
    ];

    for (const question of invalidNouls) {
      const params = { state, questions: { invalid: question } };
      const harness = createHarness({ typesafeKey: DIRECT_KEY });
      const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

      expect(rawSchemaAccepts(harness, params)).toBe(false);
      await expect(callTool(harness, params)).rejects.toThrow(/noul/i);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
    }
  });

  it("rejects unknown Noul outcome keys", async () => {
    const params = {
      state,
      questions: {
        invalid: {
          type: "noul",
          instructions: "Ready?",
          criteria: { maybe: "Ready" },
        },
      },
    };
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

    expect(rawSchemaAccepts(harness, params)).toBe(false);
    await expect(callTool(harness, params)).rejects.toThrow(/may only describe/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it("uses only own Noul outcome keys", async () => {
    const accepted = {
      state,
      questions: {
        valid: { type: "noul", instructions: null, criteria: { true: "Ready to ship" } },
      },
    };
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { requests } = installFetch([
      () => jsonResponse(responseFor(accepted.questions, "jev-1.14.0")),
    ]);

    expect(rawSchemaAccepts(harness, accepted)).toBe(true);
    await callTool(harness, accepted);
    const sent = (await requests[0]?.json()) as {
      questions: { valid: { criteria: Record<string, unknown> } };
    };
    expect(Object.getOwnPropertyNames(sent.questions.valid.criteria)).toEqual(["true"]);

    const inheritedOnly = Object.create({ true: "Inherited" }) as Record<string, unknown>;
    const rejected = {
      state,
      questions: { invalid: { type: "noul", instructions: null, criteria: inheritedOnly } },
    };
    const rejectedHarness = createHarness({ typesafeKey: DIRECT_KEY });
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

    expect(rawSchemaAccepts(rejectedHarness, JSON.parse(JSON.stringify(rejected)))).toBe(false);
    await expect(callTool(rejectedHarness, rejected)).rejects.toThrow(/noul/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rejectedHarness.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it("accepts exact Choice and Score boundaries", async () => {
    const cases: Record<string, Record<string, unknown>> = {
      choice_one: { type: "choice", instructions: "Pick", criteria: { only: null } },
      choice_255: {
        type: "choice",
        instructions: "Pick",
        criteria: Object.fromEntries(
          Array.from({ length: 255 }, (_, index) => [`option_${index}`, null]),
        ),
      },
      score_one: { type: "score", instructions: "Rate", criteria: ["Only level"] },
      score_ten: {
        type: "score",
        instructions: "Rate",
        criteria: Array.from({ length: 10 }, (_, index) => `level ${index}`),
      },
    };
    const schemaHarness = createHarness();

    for (const [id, question] of Object.entries(cases)) {
      const questions = { [id]: question };
      const params = { state, questions };
      expect(rawSchemaAccepts(schemaHarness, params)).toBe(true);

      const harness = createHarness({ typesafeKey: DIRECT_KEY });
      const { requests } = installFetch([() => jsonResponse(responseFor(questions, "jev-1.14.0"))]);
      const result = await callTool(harness, params);

      expect(requests).toHaveLength(1);
      expect(await requests[0]?.json()).toEqual({
        state,
        model: "jev-latest",
        questions,
      });
      expect(result.details.answers[id]).toEqual(answerForQuestion(question));
    }
  });

  it("rejects out-of-range criteria before credentials", async () => {
    const cases = [
      {
        question: { type: "choice", instructions: "Which?", criteria: {} },
        message: /between 1 and 255 options/i,
      },
      {
        question: {
          type: "choice",
          instructions: "Which?",
          criteria: Object.fromEntries(
            Array.from({ length: 256 }, (_, index) => [`option_${index}`, "rubric"]),
          ),
        },
        message: /between 1 and 255 options/i,
      },
      {
        question: { type: "score", instructions: "How much?", criteria: [] },
        message: /between 1 and 10 levels/i,
      },
      {
        question: {
          type: "score",
          instructions: "How much?",
          criteria: Array.from({ length: 11 }, (_, index) => `level ${index}`),
        },
        message: /between 1 and 10 levels/i,
      },
    ];

    for (const { question, message } of cases) {
      const params = { state, questions: { invalid: question } };
      const harness = createHarness({ typesafeKey: DIRECT_KEY });
      const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

      expect(rawSchemaAccepts(harness, params)).toBe(false);
      await expect(callTool(harness, params)).rejects.toThrow(message);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
    }
  });

  it("rejects null Score levels and scalar descriptions", async () => {
    const cases = [
      {
        question: { type: "score", instructions: "How much?", criteria: ["Low", null] },
        message: /score level 1 must be a string, object, or array/i,
      },
      {
        question: { type: "noul", instructions: 42 },
        message: /instructions must be a string, object, or array or null/i,
      },
      {
        question: { type: "noul", instructions: true },
        message: /instructions must be a string, object, or array or null/i,
      },
      {
        question: {
          type: "noul",
          instructions: "Is this valid?",
          criteria: { true: 1 },
        },
        message: /criterion "true" must be a string, object, or array or null/i,
      },
      {
        question: {
          type: "choice",
          instructions: "Which?",
          criteria: { yes: 1, no: false },
        },
        message: /must describe the option/i,
      },
    ];

    for (const { question, message } of cases) {
      const params = { state, questions: { invalid: question } };
      const harness = createHarness({ typesafeKey: DIRECT_KEY });
      const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

      expect(rawSchemaAccepts(harness, params)).toBe(false);
      await expect(callTool(harness, params)).rejects.toThrow(message);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
    }
  });

  it("rejects non-JSON nested values without fetching", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);
    const cyclicState: Record<string, unknown> = {};
    cyclicState.self = cyclicState;
    const cyclicDescription: Record<string, unknown> = {};
    cyclicDescription.self = cyclicDescription;

    await expect(
      callTool(harness, {
        state: { callback: () => "lost by JSON.stringify" },
        questions: {
          valid: { type: "noul", instructions: "Is this valid?" },
        },
      }),
    ).rejects.toThrow(/state must be a JSON string, object, or array/i);

    await expect(
      callTool(harness, {
        state,
        questions: {
          invalid: { type: "noul", instructions: { missing: undefined } },
        },
      }),
    ).rejects.toThrow(/instructions must be a string, object, or array/i);

    await expect(
      callTool(harness, {
        state: new Date("2026-09-27T00:00:00Z"),
        questions: {
          valid: { type: "noul", instructions: "Is this valid?" },
        },
      }),
    ).rejects.toThrow(/state must be a JSON string, object, or array/i);

    await expect(
      callTool(harness, {
        state: true,
        questions: {
          valid: { type: "noul", instructions: "Is this valid?" },
        },
      }),
    ).rejects.toThrow(/state must be a JSON string, object, or array/i);

    await expect(
      callTool(harness, {
        state: Number.NaN,
        questions: {
          valid: { type: "noul", instructions: "Is this valid?" },
        },
      }),
    ).rejects.toThrow(/state must be a JSON string, object, or array/i);

    await expect(
      callTool(harness, {
        state: { value: Number.POSITIVE_INFINITY },
        questions: {
          valid: { type: "noul", instructions: "Is this valid?" },
        },
      }),
    ).rejects.toThrow(/state must be a JSON string, object, or array/i);

    await expect(
      callTool(harness, {
        state: cyclicState,
        questions: {
          valid: { type: "noul", instructions: "Is this valid?" },
        },
      }),
    ).rejects.toThrow(/state must be a JSON string, object, or array/i);

    await expect(
      callTool(harness, {
        state,
        questions: {
          invalid: { type: "noul", instructions: { value: Number.NaN } },
        },
      }),
    ).rejects.toThrow(/instructions must be a string, object, or array/i);

    await expect(
      callTool(harness, {
        state,
        questions: {
          invalid: { type: "noul", instructions: cyclicDescription },
        },
      }),
    ).rejects.toThrow(/instructions must be a string, object, or array/i);

    await expect(
      callTool(harness, {
        state,
        questions: {
          invalid: {
            type: "choice",
            instructions: "Which?",
            criteria: { yes: true, no: false },
          },
        },
      }),
    ).rejects.toThrow(/must describe the option/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it("preserves prototype-sensitive IDs through Pi validation", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY });
    const questions = JSON.parse(
      `{"__proto__": {"type": "noul", "instructions": "Is the payload hostile?"}, "constructor": {"type": "noul", "instructions": "Is it a constructor?"}, "toString": {"type": "choice", "criteria": {"__proto__": null, "constructor": null, "toString": null}}}`,
    ) as Record<string, unknown>;
    const answers = JSON.parse(
      `{"__proto__": {"type": "noul", "noul": 0.4}, "constructor": {"type": "noul", "noul": 0.5}, "toString": {"type": "choice", "choice": "__proto__", "confidence": 1, "probabilities": {"__proto__": 1, "constructor": 0, "toString": 0}}}`,
    ) as Record<string, unknown>;
    const params = { state, questions };
    expect(rawSchemaAccepts(harness, params)).toBe(true);
    const { requests } = installFetch([
      () =>
        jsonResponse({
          model: "jev-1.14.0",
          answers,
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
    ]);

    const result = await callValidatedTool(harness, params);
    const sent = (await requests[0]?.json()) as { questions: Record<string, unknown> };

    expect(Object.getOwnPropertyNames(sent.questions).sort()).toEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);
    expect(own(sent.questions, "__proto__")).toEqual(own(questions, "__proto__"));
    const sentChoice = own(sent.questions, "toString") as { criteria: Record<string, unknown> };
    expect(Object.getOwnPropertyNames(sentChoice.criteria).sort()).toEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);

    expect(Object.getOwnPropertyNames(result.details.answers).sort()).toEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);
    expect(own(result.details.answers, "__proto__")).toEqual(own(answers, "__proto__"));
    const content = JSON.parse(result.content[0]?.text ?? "{}") as {
      answers: Record<string, unknown>;
    };
    expect(Object.getOwnPropertyNames(content.answers).sort()).toEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);
    expect(own(content.answers, "__proto__")).toEqual(own(answers, "__proto__"));
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
    expect(Object.hasOwn(sent.questions, "__proto__")).toBe(true);
    expect(Object.hasOwn(sent.questions, "toString")).toBe(true);
    expect(own(sent.questions, "__proto__")).toEqual(own(sensitive, "__proto__"));

    const answers = result.details.answers;
    expect(Object.hasOwn(answers, "__proto__")).toBe(true);
    expect(Object.hasOwn(answers, "toString")).toBe(true);
    expect(own(answers, "__proto__")).toEqual({ type: "noul", noul: 0.4 });
    const content = JSON.parse(result.content[0]?.text ?? "{}") as {
      answers: Record<string, unknown>;
    };
    expect(own(content.answers, "__proto__")).toEqual({ type: "noul", noul: 0.4 });
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

  it("serializes structured instructions and criteria descriptions", async () => {
    const structuredQuestions = {
      is_urgent: {
        type: "noul",
        instructions: {
          question: "Does this convey urgency?",
          evidence: ["three days"],
          priority: 3,
          escalated: false,
          note: null,
        },
        criteria: { true: ["Time-sensitive"], false: { meaning: "No urgency" } },
      },
      department: {
        type: "choice",
        instructions: ["Choose the team", { source: "ticket" }],
        criteria: {
          billing: null,
          technical: { meaning: "Bugs and outages", severity: 2, confirmed: true },
        },
      },
      frustration: {
        type: "score",
        instructions: { question: "How frustrated is the customer?" },
        criteria: [{ label: "Calm", level: 0 }, ["Frustrated"], { label: "Very angry" }],
      },
    } as const;
    expect(rawSchemaAccepts(createHarness(), { state, questions: structuredQuestions })).toBe(true);

    for (const validated of [false, true]) {
      const { sent } = await runAccepted(
        { typesafeKey: DIRECT_KEY },
        "jev-1.13.0",
        structuredQuestions,
        validated,
      );

      expect(sent).toEqual({
        state,
        model: "jev-latest",
        questions: structuredQuestions,
      });
    }
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

  it("falls back exactly once when the direct request signal times out", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const directTimeout = new AbortController();
    const fallbackTimeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(directTimeout.signal)
      .mockReturnValueOnce(fallbackTimeout.signal);
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const { requests } = installFetch([
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          markStarted();
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        }),
      () => jsonResponse(successBody),
    ]);

    const pending = callTool(harness, { state, questions });
    await started;
    directTimeout.abort();
    const result = await pending;

    expect(requests).toHaveLength(2);
    expect(result.details.backend).toBe("command-code");
  });

  it("reports a timeout while reading a direct response body", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: undefined });
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    let markParsing!: () => void;
    const parsing = new Promise<void>((resolve) => {
      markParsing = resolve;
    });
    installFetch([
      (request) =>
        ({
          ok: true,
          status: 200,
          json: () =>
            new Promise<unknown>((_resolve, reject) => {
              markParsing();
              request.signal.addEventListener("abort", () => reject(request.signal.reason), {
                once: true,
              });
            }),
        }) as Response,
    ]);

    const pending = callTool(harness, { state, questions });
    await parsing;
    timeout.abort();

    await expect(pending).rejects.toThrow(/TypeSafe.*timeout/i);
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
    ["Noul probability outside 0-1", { type: "noul", noul: 2 }],
    [
      "Choice selecting an undeclared option",
      {
        type: "choice",
        choice: "sales",
        probabilities: { billing: 0.5, technical: 0.5 },
        confidence: 0.5,
      },
    ],
    [
      "Choice probabilities that do not sum to one",
      {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.9, technical: 0.9 },
        confidence: 0.5,
      },
    ],
    [
      "Choice selecting a lower-probability option",
      {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.2, technical: 0.8 },
        confidence: 0.5,
      },
    ],
    ["Score missing distribution metadata", { type: "score", score: 1 }],
    [
      "Score inconsistent with its probability-weighted value",
      {
        type: "score",
        score: 0,
        legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
        probabilities: { "0": 0, "1": 1, "2": 0 },
        confidence: 0.5,
      },
    ],
  ])("falls back on malformed answer data: %s", async (label, malformedAnswer) => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const malformed = structuredClone(successBody);
    const answerId = label.startsWith("Noul")
      ? "is_urgent"
      : label.startsWith("Choice")
        ? "department"
        : "frustration";
    (malformed.answers as Record<string, unknown>)[answerId] = malformedAnswer;
    const { requests } = installFetch([
      () => jsonResponse(malformed),
      () => jsonResponse(successBody),
    ]);

    const result = await callTool(harness, { state, questions });

    expect(requests).toHaveLength(2);
    expect(result.details.backend).toBe("command-code");
  });

  it.each([
    ["400", 400],
    ["404", 404],
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

  it("treats caller cancellation during fetch as terminal and does not fall back", async () => {
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
    expect((error as Error).message).toMatch(/TypeSafe.*cancel/i);
    expect((error as Error).message).not.toMatch(/timed out|timeout/i);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(DIRECT_URL);
  });

  it("treats caller cancellation during response parsing as terminal", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const controller = new AbortController();
    const { requests } = installFetch([
      () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            controller.abort();
            throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
          },
        }) as unknown as Response,
      () => jsonResponse(successBody),
    ]);

    const error = await callTool(harness, { state, questions }, controller.signal).catch(
      (cause: Error) => cause,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/TypeSafe.*cancel/i);
    expect(requests).toHaveLength(1);
  });

  it("does not start fallback when the caller aborts after a retryable response", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const controller = new AbortController();
    const { requests } = installFetch([
      () => {
        controller.abort();
        return new Response("unavailable", { status: 503 });
      },
      () => jsonResponse(successBody),
    ]);

    const error = await callTool(harness, { state, questions }, controller.signal).catch(
      (cause: Error) => cause,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/TypeSafe.*cancel/i);
    expect(requests).toHaveLength(1);
  });

  it("stops a pre-cancelled call before resolving credentials", async () => {
    const harness = createHarness({ typesafeKey: undefined, commandKey: undefined });
    const controller = new AbortController();
    controller.abort();
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

    await expect(callTool(harness, { state, questions }, controller.signal)).rejects.toThrow(
      /TypeSafe.*cancel/i,
    );

    expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports cancellation while resolving fallback credentials", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const controller = new AbortController();
    harness.getApiKeyForProvider.mockImplementation(async (provider: string) => {
      if (provider === "typesafe") return DIRECT_KEY;
      controller.abort();
      return FALLBACK_KEY;
    });
    const { requests } = installFetch([
      () => new Response("unavailable", { status: 503 }),
      () => jsonResponse(successBody),
    ]);

    await expect(callTool(harness, { state, questions }, controller.signal)).rejects.toThrow(
      /Command Code.*cancel/i,
    );

    expect(requests).toHaveLength(1);
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

describe("TypeSafe decide gateway question limit", () => {
  const limitMessage = "at most 100 questions per request; received 101";

  it("allows 101 direct questions", async () => {
    const directQuestions = noulQuestions(101);
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => jsonResponse(responseFor(directQuestions, "jev-1.14.0")),
    ]);

    const result = await callTool(harness, { state, questions: directQuestions });

    expect(requests.map((request) => request.url)).toEqual([DIRECT_URL]);
    expect(result.details.backend).toBe("typesafe");
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
  });

  it("allows 100 initial gateway questions", async () => {
    const gatewayQuestions = noulQuestions(100);
    const harness = createHarness({ typesafeKey: undefined, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => jsonResponse(responseFor(gatewayQuestions, "typesafe/jev")),
    ]);

    const result = await callTool(harness, { state, questions: gatewayQuestions });

    expect(requests.map((request) => request.url)).toEqual([FALLBACK_URL]);
    expect(result.details.backend).toBe("command-code");
  });

  it("allows 100 fallback questions", async () => {
    const fallbackQuestions = noulQuestions(100);
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => new Response("unavailable", { status: 503 }),
      () => jsonResponse(responseFor(fallbackQuestions, "typesafe/jev")),
    ]);

    const result = await callTool(harness, { state, questions: fallbackQuestions });

    expect(requests.map((request) => request.url)).toEqual([DIRECT_URL, FALLBACK_URL]);
    expect(result.details.backend).toBe("command-code");
  });

  it("rejects 101 initial gateway questions before credentials", async () => {
    for (const commandKey of [undefined, FALLBACK_KEY]) {
      const harness = createHarness({ typesafeKey: undefined, commandKey });
      const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

      const error = (await callTool(harness, {
        state,
        questions: noulQuestions(101),
      }).catch((cause: Error) => cause)) as Error;

      expect(error.message).toContain(limitMessage);
      expect(error.message).not.toContain(DIRECT_KEY);
      expect(error.message).not.toContain(FALLBACK_KEY);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(harness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
    }

    vi.stubEnv("TYPESAFE_API_KEY", "   ");
    const blankHostHarness = createHarness({ typesafeKey: undefined, commandKey: FALLBACK_KEY });
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

    await expect(
      callTool(blankHostHarness, { state, questions: noulQuestions(101) }),
    ).rejects.toThrow(limitMessage);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(blankHostHarness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
  });

  it.each([
    [
      "401",
      () => new Response(JSON.stringify({ error: "secret-upstream-marker" }), { status: 401 }),
      /TypeSafe.*401/,
    ],
    [
      "403",
      () => new Response(JSON.stringify({ error: "secret-upstream-marker" }), { status: 403 }),
      /TypeSafe.*403/,
    ],
    [
      "429",
      () => new Response(JSON.stringify({ error: "secret-upstream-marker" }), { status: 429 }),
      /TypeSafe.*429/,
    ],
    [
      "529",
      () => new Response(JSON.stringify({ error: "secret-upstream-marker" }), { status: 529 }),
      /TypeSafe.*529/,
    ],
    [
      "500",
      () => new Response(JSON.stringify({ error: "secret-upstream-marker" }), { status: 500 }),
      /TypeSafe.*500/,
    ],
    [
      "503",
      () => new Response(JSON.stringify({ error: "secret-upstream-marker" }), { status: 503 }),
      /TypeSafe.*503/,
    ],
    [
      "transport",
      () => {
        throw new TypeError("secret-upstream-marker transport failed");
      },
      /TypeSafe.*transport/,
    ],
    [
      "malformed",
      () =>
        jsonResponse({
          model: 42,
          answers: "nope",
          usage: { input_tokens: "many" },
          error: "secret-upstream-marker",
        }),
      /TypeSafe.*malformed/,
    ],
  ])(
    "retains direct failure when 101 questions prevent fallback: %s",
    async (_label, handler, expected) => {
      for (const commandKey of [FALLBACK_KEY, undefined]) {
        const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey });
        const { requests } = installFetch([handler]);

        const error = (await callTool(harness, {
          state,
          questions: noulQuestions(101),
        }).catch((cause: Error) => cause)) as Error;

        expect(requests.map((request) => request.url)).toEqual([DIRECT_URL]);
        expect(harness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
        expect(error.message).toMatch(expected);
        expect(error.message).toContain(limitMessage);
        expect(error.message).not.toContain(DIRECT_KEY);
        expect(error.message).not.toContain(FALLBACK_KEY);
        expect(error.message).not.toContain("secret-upstream-marker");
      }
    },
  );

  it("retains a direct timeout when 101 questions prevent fallback", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const directTimeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(directTimeout.signal);
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const { requests } = installFetch([
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          markStarted();
          request.signal.addEventListener(
            "abort",
            () => reject(new Error("secret-upstream-marker timeout")),
            { once: true },
          );
        }),
    ]);

    const pending = callTool(harness, { state, questions: noulQuestions(101) });
    await started;
    directTimeout.abort();
    const error = (await pending.catch((cause: Error) => cause)) as Error;

    expect(requests.map((request) => request.url)).toEqual([DIRECT_URL]);
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
    expect(error.message).toMatch(/TypeSafe.*timeout/);
    expect(error.message).toContain(limitMessage);
    expect(error.message).not.toContain("secret-upstream-marker");
  });

  it("retains a direct body timeout when 101 questions prevent fallback", async () => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const directTimeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(directTimeout.signal);
    let markParsing!: () => void;
    const parsing = new Promise<void>((resolve) => {
      markParsing = resolve;
    });
    const { requests } = installFetch([
      (request) =>
        ({
          ok: true,
          status: 200,
          json: () =>
            new Promise<unknown>((_resolve, reject) => {
              markParsing();
              request.signal.addEventListener(
                "abort",
                () => reject(new Error("secret-upstream-marker timeout")),
                { once: true },
              );
            }),
        }) as Response,
    ]);

    const pending = callTool(harness, { state, questions: noulQuestions(101) });
    await parsing;
    directTimeout.abort();
    const error = (await pending.catch((cause: Error) => cause)) as Error;

    expect(requests.map((request) => request.url)).toEqual([DIRECT_URL]);
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
    expect(error.message).toMatch(/TypeSafe.*timeout/);
    expect(error.message).toContain(limitMessage);
    expect(error.message).not.toContain("secret-upstream-marker");
  });

  it.each([
    ["400", 400],
    ["404", 404],
    ["413", 413],
    ["415", 415],
    ["422", 422],
  ])("keeps oversized terminal direct failures terminal: %s", async (_label, status) => {
    const harness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => new Response(JSON.stringify({ error: "terminal" }), { status }),
    ]);

    const error = (await callTool(harness, {
      state,
      questions: noulQuestions(101),
    }).catch((cause: Error) => cause)) as Error;

    expect(requests.map((request) => request.url)).toEqual([DIRECT_URL]);
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
    expect(error.message).toMatch(new RegExp(`TypeSafe.*${status}`));
    expect(error.message).not.toMatch(/100/);
    expect(error.message).not.toMatch(/at most/);
  });

  it("cancels oversized calls before the gateway guard", async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = createHarness({ typesafeKey: undefined, commandKey: FALLBACK_KEY });
    const { fetchMock } = installFetch([() => jsonResponse(successBody)]);

    const error = (await callTool(
      harness,
      { state, questions: noulQuestions(101) },
      controller.signal,
    ).catch((cause: Error) => cause)) as Error;

    expect(error.message).toMatch(/TypeSafe.*cancel/i);
    expect(error.message).not.toMatch(/100/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.getApiKeyForProvider).not.toHaveBeenCalled();

    const duringHarness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const duringController = new AbortController();
    duringHarness.getApiKeyForProvider.mockImplementation(async (provider: string) => {
      if (provider === "typesafe") {
        duringController.abort();
        return DIRECT_KEY;
      }
      return FALLBACK_KEY;
    });
    const duringFetch = installFetch([() => jsonResponse(successBody)]);

    const duringError = (await callTool(
      duringHarness,
      { state, questions: noulQuestions(101) },
      duringController.signal,
    ).catch((cause: Error) => cause)) as Error;

    expect(duringError.message).toMatch(/TypeSafe.*cancel/i);
    expect(duringError.message).not.toMatch(/100/);
    expect(duringFetch.fetchMock).not.toHaveBeenCalled();
    expect(duringHarness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
  });

  it("cancels oversized direct failures before fallback credentials", async () => {
    const fetchController = new AbortController();
    const fetchHarness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const { requests } = installFetch([
      () => {
        fetchController.abort();
        return Promise.reject(
          Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
        );
      },
    ]);

    const fetchError = (await callTool(
      fetchHarness,
      { state, questions: noulQuestions(101) },
      fetchController.signal,
    ).catch((cause: Error) => cause)) as Error;

    expect(requests.map((request) => request.url)).toEqual([DIRECT_URL]);
    expect(fetchHarness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
    expect(fetchError.message).toMatch(/TypeSafe.*cancel/i);
    expect(fetchError.message).not.toMatch(/100/);

    const bodyController = new AbortController();
    const bodyHarness = createHarness({ typesafeKey: DIRECT_KEY, commandKey: FALLBACK_KEY });
    const bodyFetch = installFetch([
      () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            bodyController.abort();
            return responseFor(noulQuestions(101), "jev-1.14.0");
          },
        }) as unknown as Response,
    ]);

    const bodyError = (await callTool(
      bodyHarness,
      { state, questions: noulQuestions(101) },
      bodyController.signal,
    ).catch((cause: Error) => cause)) as Error;

    expect(bodyFetch.requests.map((request) => request.url)).toEqual([DIRECT_URL]);
    expect(bodyHarness.getApiKeyForProvider).not.toHaveBeenCalledWith("command-code");
    expect(bodyError.message).toMatch(/TypeSafe.*cancel/i);
    expect(bodyError.message).not.toMatch(/100/);
  });
});

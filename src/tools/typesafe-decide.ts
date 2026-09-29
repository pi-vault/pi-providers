// src/tools/typesafe-decide.ts

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, type TUnsafe, Type } from "typebox";

const DIRECT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DIRECT_MODEL = "jev-latest";
const FALLBACK_ENDPOINT = "https://api.commandcode.ai/provider/v1/systemone";
const FALLBACK_MODEL = "typesafe/jev";
const REQUEST_TIMEOUT_MS = 10_000;

const MIN_CHOICE_OPTIONS = 2;
const MAX_CHOICE_OPTIONS = 255;
const MIN_SCORE_LEVELS = 2;
const MAX_SCORE_LEVELS = 10;
const PROBABILITY_TOLERANCE = 1e-6;

interface NoulQuestion {
  type: "noul";
  instructions: unknown;
  criteria?: { true?: unknown; false?: unknown };
}

interface ChoiceQuestion {
  type: "choice";
  instructions: unknown;
  criteria: Record<string, unknown>;
}

interface ScoreQuestion {
  type: "score";
  instructions: unknown;
  criteria: unknown[];
}

type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
type QuestionMap = Record<string, Question>;

/** A structured JSON value TypeSafe accepts for instructions and rubric descriptions. */
type QuestionValue = string | object | unknown[];
type ChoiceRubricValue = QuestionValue | null;

const questionValueSchema = Type.Union([
  Type.String(),
  Type.Object({}, { additionalProperties: Type.Unknown() }),
  Type.Array(Type.Unknown()),
]);
const choiceRubricValueSchema = Type.Union([questionValueSchema, Type.Null()]);

const questionSchema = Type.Union([
  Type.Object({
    type: Type.Literal("noul"),
    instructions: questionValueSchema,
    criteria: Type.Optional(
      Type.Object({
        true: Type.Optional(questionValueSchema),
        false: Type.Optional(questionValueSchema),
      }),
    ),
  }),
  Type.Object({
    type: Type.Literal("choice"),
    instructions: questionValueSchema,
    criteria: Type.Unsafe<Record<string, ChoiceRubricValue>>(
      Type.Object(
        {},
        {
          minProperties: MIN_CHOICE_OPTIONS,
          maxProperties: MAX_CHOICE_OPTIONS,
          additionalProperties: choiceRubricValueSchema,
        },
      ),
    ),
  }),
  Type.Object({
    type: Type.Literal("score"),
    instructions: questionValueSchema,
    criteria: Type.Unsafe<unknown[]>(
      Type.Array(questionValueSchema, {
        minItems: MIN_SCORE_LEVELS,
        maxItems: MAX_SCORE_LEVELS,
      }),
    ),
  }),
]);

export const decideParameters = Type.Object({
  state: Type.Union([
    Type.String(),
    Type.Object({}, { additionalProperties: Type.Unknown() }),
    Type.Array(Type.Unknown()),
  ]),
  questions: Type.Unsafe<QuestionMap>(
    Type.Object({}, { minProperties: 1, additionalProperties: questionSchema }),
  ),
});

export interface DecideDetails {
  backend: "typesafe" | "command-code";
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}

interface Decision {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}

type RetryReason = "timeout" | "transport" | "malformed";

type Failure =
  | { kind: "cancelled" }
  | { kind: "terminal"; status: number }
  | { kind: "retryable"; status: number }
  | { kind: "retryable"; reason: RetryReason };

type Attempt = { kind: "ok"; decision: Decision } | Failure;

/** Own-key map so prototype-sensitive ids such as `__proto__` stay ordinary keys. */
function ownKeyRecord<TValue>(
  value: unknown,
  build: (key: string) => TValue,
): Record<string, TValue> {
  const out = Object.create(null) as Record<string, TValue>;
  for (const key of Object.getOwnPropertyNames(value as object)) {
    out[key] = build(key);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object" || (!Array.isArray(value) && !isPlainObject(value))) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.getOwnPropertyNames(value).every((key) =>
        isJsonValue((value as Record<string, unknown>)[key], seen),
      );
  seen.delete(value);
  return valid;
}

function isQuestionValue(value: unknown): value is QuestionValue {
  return (
    (typeof value === "string" || Array.isArray(value) || isPlainObject(value)) &&
    isJsonValue(value)
  );
}

function isChoiceRubricValue(value: unknown): value is ChoiceRubricValue {
  return value === null || isQuestionValue(value);
}

function validateQuestion(id: string, raw: unknown): Question {
  if (!isPlainObject(raw)) {
    throw new Error(`Question "${id}" must be an object`);
  }

  const type = raw.type;
  if (type !== "noul" && type !== "choice" && type !== "score") {
    throw new Error(`Question "${id}" must declare type "noul", "choice", or "score"`);
  }
  if (!Object.hasOwn(raw, "instructions")) {
    throw new Error(`Question "${id}" must provide "instructions"`);
  }
  const instructions = raw.instructions;
  if (!isQuestionValue(instructions)) {
    throw new Error(`Question "${id}" instructions must be a string, object, or array`);
  }

  if (type === "noul") {
    if (!Object.hasOwn(raw, "criteria")) return { type, instructions };
    if (!isPlainObject(raw.criteria)) {
      throw new Error(
        `Question "${id}" noul criteria must be an object with "true" and/or "false"`,
      );
    }
    const criteria: NoulQuestion["criteria"] = {};
    for (const key of Object.getOwnPropertyNames(raw.criteria)) {
      if (key !== "true" && key !== "false") {
        throw new Error(`Question "${id}" noul criteria may only describe "true" and/or "false"`);
      }
      const value = raw.criteria[key];
      if (!isQuestionValue(value)) {
        throw new Error(
          `Question "${id}" noul criterion "${key}" must be a string, object, or array`,
        );
      }
      criteria[key] = value;
    }
    return { type, instructions, criteria };
  }

  if (type === "choice") {
    if (!isPlainObject(raw.criteria)) {
      throw new Error(
        `Question "${id}" choice criteria must be a map of ${MIN_CHOICE_OPTIONS}-${MAX_CHOICE_OPTIONS} named options`,
      );
    }
    const options = Object.getOwnPropertyNames(raw.criteria);
    if (options.length < MIN_CHOICE_OPTIONS || options.length > MAX_CHOICE_OPTIONS) {
      throw new Error(
        `Question "${id}" choice criteria must have between ${MIN_CHOICE_OPTIONS} and ${MAX_CHOICE_OPTIONS} options`,
      );
    }
    const optionsByKey = raw.criteria;
    const criteria = ownKeyRecord(optionsByKey, (option) => {
      const value = optionsByKey[option];
      if (!isChoiceRubricValue(value)) {
        throw new Error(`Question "${id}" option "${option}" must describe the option`);
      }
      return value;
    });
    return { type, instructions, criteria };
  }

  if (!Array.isArray(raw.criteria)) {
    throw new Error(
      `Question "${id}" score criteria must be an array of ${MIN_SCORE_LEVELS}-${MAX_SCORE_LEVELS} ordered levels`,
    );
  }
  if (raw.criteria.length < MIN_SCORE_LEVELS || raw.criteria.length > MAX_SCORE_LEVELS) {
    throw new Error(
      `Question "${id}" score criteria must have between ${MIN_SCORE_LEVELS} and ${MAX_SCORE_LEVELS} levels`,
    );
  }
  raw.criteria.forEach((level, index) => {
    if (!isQuestionValue(level)) {
      throw new Error(`Question "${id}" score level ${index} must be a string, object, or array`);
    }
  });
  return { type, instructions, criteria: [...raw.criteria] };
}

function validateQuestions(raw: unknown): QuestionMap {
  if (!isPlainObject(raw)) {
    throw new Error("questions must be an object of typed questions");
  }
  const ids = Object.getOwnPropertyNames(raw);
  if (ids.length === 0) {
    throw new Error("questions must contain at least one question");
  }
  return ownKeyRecord(raw, (id) => validateQuestion(id, raw[id]));
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isProbabilityDistribution(
  value: unknown,
  keys: readonly string[],
): value is Record<string, number> {
  if (!isPlainObject(value)) return false;
  const actual = Object.getOwnPropertyNames(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key) && isProbability(value[key])) &&
    Math.abs(keys.reduce((sum, key) => sum + (value[key] as number), 0) - 1) <=
      PROBABILITY_TOLERANCE
  );
}

function validateAnswer(id: string, requested: Question, answer: unknown): void {
  if (!isPlainObject(answer) || answer.type !== requested.type) {
    throw new Error(`Answer "${id}" must be a ${requested.type} answer`);
  }
  if (requested.type === "noul") {
    if (!isProbability(answer.noul)) {
      throw new Error(`Answer "${id}" is missing a valid noul probability`);
    }
    return;
  }

  if (!isProbability(answer.confidence)) {
    throw new Error(`Answer "${id}" is missing a valid confidence`);
  }

  if (requested.type === "choice") {
    const options = Object.getOwnPropertyNames(requested.criteria);
    const probabilities = answer.probabilities;
    if (
      typeof answer.choice !== "string" ||
      !Object.hasOwn(requested.criteria, answer.choice) ||
      !isProbabilityDistribution(probabilities, options)
    ) {
      throw new Error(`Answer "${id}" is not a valid choice answer`);
    }
    const highestProbability = Math.max(...options.map((option) => probabilities[option]));
    if (probabilities[answer.choice] + PROBABILITY_TOLERANCE < highestProbability) {
      throw new Error(`Answer "${id}" is not a valid choice answer`);
    }
    return;
  }

  const levels = requested.criteria.map((_, index) => String(index));
  const legend = answer.legend;
  const probabilities = answer.probabilities;
  if (
    typeof answer.score !== "number" ||
    !Number.isFinite(answer.score) ||
    answer.score < 0 ||
    answer.score > requested.criteria.length - 1 ||
    !isProbabilityDistribution(probabilities, levels) ||
    !isPlainObject(legend) ||
    Object.getOwnPropertyNames(legend).length !== levels.length ||
    !levels.every((level) => Object.hasOwn(legend, level))
  ) {
    throw new Error(`Answer "${id}" is not a valid score answer`);
  }
  const weightedScore = levels.reduce((sum, level, index) => sum + index * probabilities[level], 0);
  if (Math.abs(answer.score - weightedScore) > PROBABILITY_TOLERANCE) {
    throw new Error(`Answer "${id}" is not a valid score answer`);
  }
}

function parseDecision(payload: unknown, questions: QuestionMap): Decision | undefined {
  if (!isPlainObject(payload)) return undefined;

  const model = payload.model;
  if (typeof model !== "string" || model.trim() === "") return undefined;

  if (!isPlainObject(payload.answers) || !isPlainObject(payload.usage)) return undefined;
  const { input_tokens: inputTokens, output_tokens: outputTokens } = payload.usage;
  if (!isTokenCount(inputTokens) || !isTokenCount(outputTokens)) return undefined;

  try {
    const rawAnswers = payload.answers;
    const answers = ownKeyRecord(questions, (id) => {
      const answer = rawAnswers[id];
      validateAnswer(id, questions[id] as Question, answer);
      return answer;
    });
    return {
      model,
      answers,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    };
  } catch {
    return undefined;
  }
}

async function attemptDecision(
  endpoint: string,
  model: string,
  apiKey: string,
  state: unknown,
  questions: QuestionMap,
  callerSignal: AbortSignal | undefined,
): Promise<Attempt> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

  if (callerSignal?.aborted) return { kind: "cancelled" };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ state, model, questions }),
      signal,
    });
  } catch {
    if (callerSignal?.aborted) return { kind: "cancelled" };
    return { kind: "retryable", reason: timeoutSignal.aborted ? "timeout" : "transport" };
  }

  if (callerSignal?.aborted) return { kind: "cancelled" };
  if (!response.ok) {
    return [401, 403, 429, 529].includes(response.status) || response.status >= 500
      ? { kind: "retryable", status: response.status }
      : { kind: "terminal", status: response.status };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (callerSignal?.aborted) return { kind: "cancelled" };
    return {
      kind: "retryable",
      reason: timeoutSignal.aborted ? "timeout" : "malformed",
    };
  }

  if (callerSignal?.aborted) return { kind: "cancelled" };
  const decision = parseDecision(payload, questions);
  return decision ? { kind: "ok", decision } : { kind: "retryable", reason: "malformed" };
}

function failureMessage(backendLabel: string, attempt: Failure): string {
  if (attempt.kind === "cancelled") {
    return `${backendLabel} request was cancelled by the caller`;
  }
  if (attempt.kind === "terminal") {
    return `${backendLabel} rejected the request with status ${attempt.status}`;
  }
  if ("status" in attempt) {
    return `${backendLabel} failed with status ${attempt.status}`;
  }
  if (attempt.reason === "timeout") {
    return `${backendLabel} failed after a ${REQUEST_TIMEOUT_MS / 1000}s timeout`;
  }
  return `${backendLabel} failed after a ${attempt.reason} failure`;
}

function throwIfCancelled(signal: AbortSignal | undefined, backendLabel: string): void {
  if (signal?.aborted) {
    throw new Error(failureMessage(backendLabel, { kind: "cancelled" }));
  }
}

function nonBlank(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

/** Resolves a host credential, treating blank values as absent. */
async function resolveKey(pending: Promise<string | undefined>): Promise<string | undefined> {
  return nonBlank(await pending);
}

export function registerTypeSafeDecisionTool(pi: ExtensionAPI): void {
  const tool: ToolDefinition<TUnsafe<{ state: unknown; questions: QuestionMap }>, DecideDetails> = {
    name: "typesafe_decide",
    label: "TypeSafe Decide",
    description:
      "Decide typed questions (Noul yes/no, Choice among named options, Score across ordered levels) about a state with TypeSafe Jev. " +
      "Calls TypeSafe directly when its key is configured, otherwise Command Code. " +
      "Noul criteria are optional. Choice criteria need 2-255 options; Score criteria need 2-10 ordered levels.",
    promptSnippet: "Answer typed yes/no, multiple-choice, and scoring questions with TypeSafe Jev",
    parameters: decideParameters as never,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (
        !(
          typeof params.state === "string" ||
          Array.isArray(params.state) ||
          isPlainObject(params.state)
        ) ||
        !isJsonValue(params.state)
      ) {
        throw new Error("state must be a JSON string, object, or array");
      }
      const questions = validateQuestions(params.questions);
      const fallbackKey = () => resolveKey(ctx.modelRegistry.getApiKeyForProvider("command-code"));
      throwIfCancelled(signal, "TypeSafe");

      const registeredDirectKey = await resolveKey(
        ctx.modelRegistry.getApiKeyForProvider("typesafe"),
      );
      throwIfCancelled(signal, "TypeSafe");
      const directKey = registeredDirectKey ?? nonBlank(process.env.TYPESAFE_API_KEY);

      if (!directKey) {
        throwIfCancelled(signal, "Command Code");
        const key = await fallbackKey();
        throwIfCancelled(signal, "Command Code");
        if (!key) {
          throw new Error(
            "no TypeSafe or Command Code credentials are configured for typesafe_decide",
          );
        }
        const attempt = await attemptDecision(
          FALLBACK_ENDPOINT,
          FALLBACK_MODEL,
          key,
          params.state,
          questions,
          signal,
        );
        if (attempt.kind === "ok") return toResult("command-code", attempt.decision);
        throw new Error(failureMessage("Command Code", attempt));
      }

      const direct = await attemptDecision(
        DIRECT_ENDPOINT,
        DIRECT_MODEL,
        directKey,
        params.state,
        questions,
        signal,
      );
      if (direct.kind === "ok") return toResult("typesafe", direct.decision);
      if (direct.kind === "cancelled" || direct.kind === "terminal") {
        throw new Error(failureMessage("TypeSafe", direct));
      }

      throwIfCancelled(signal, "Command Code");
      const key = await fallbackKey();
      throwIfCancelled(signal, "Command Code");
      if (!key) {
        throw new Error(failureMessage("TypeSafe", direct));
      }

      const fallback = await attemptDecision(
        FALLBACK_ENDPOINT,
        FALLBACK_MODEL,
        key,
        params.state,
        questions,
        signal,
      );
      if (fallback.kind === "ok") return toResult("command-code", fallback.decision);
      throw new Error(failureMessage("Command Code", fallback));
    },
  };

  pi.registerTool(tool as never);
}

function toResult(backend: DecideDetails["backend"], decision: Decision) {
  const details: DecideDetails = {
    backend,
    model: decision.model,
    answers: decision.answers,
    usage: decision.usage,
  };
  const { input_tokens: input, output_tokens: output } = decision.usage;

  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
    usage: {
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

export type DecideParams = Static<typeof decideParameters>;

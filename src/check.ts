import { APIError, type NoulQuestion, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  type Guardrails,
  GuardrailsError,
  loadGuardrails,
} from "./guardrails.js";

export type Verdict = "pass" | "fail" | "unsure";

export interface AssertionResult {
  assertion: string;
  verdict: Verdict;
  /** The model's probability that the assertion holds. */
  probability: number;
}

export interface CheckResult {
  /** One per assertion, in the order the guardrails list them. */
  results: AssertionResult[];
}

/** A JSON value, as content to judge. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CheckOptions {
  /** A Vercel AI Gateway key, used instead of any key in the environment. */
  aiGatewayApiKey?: string;
  /** A TypeSafe API key, used instead of any key in the environment. */
  typesafeApiKey?: string;
}

/** The AI Gateway's TypeSafe-compatible endpoint, and Jev's name there. */
const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/typesafe";
const GATEWAY_MODEL = "typesafe-ai/jev";

/** Errors are reported in the rejection, not logged; a full-length request gets time to finish. */
const CLIENT_SETTINGS = { logLevel: "off", timeout: 60_000 } as const;

/**
 * Jev's refusal of content too long to judge says only that, not by how much,
 * and the package can't count tokens as Jev does; so it never measures or cuts.
 */
const TOO_LONG =
  "The content and assertions together are more than the model can judge in one request (about 32,000 tokens for Jev). Shrink the content and check again.";

/**
 * Check content against guardrails. `guardrails` is a YAML file's path or the
 * same settings as an object; `content` is text, or any JSON value, judged as
 * its JSON text. Rejects when no verdicts can be given, with a message saying why.
 */
export async function check(
  guardrails: string | Guardrails,
  content: string | JsonValue,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const { assertions, pass, fail } = await loadGuardrails(guardrails);
  const text =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  if (text === undefined || text.trim() === "") {
    throw new GuardrailsError(
      "The content is empty, so there is nothing to judge.",
    );
  }
  const client = modelClient(options);

  const questions: Record<string, NoulQuestion> = {};
  assertions.forEach((assertion, i) => {
    questions[`a${i}`] = { type: "noul", instructions: assertion };
  });

  let answers: Record<string, { noul: number }>;
  try {
    ({ answers } = await client.systemOne({ state: text, questions }));
  } catch (error) {
    if (tooLong(error)) throw new Error(TOO_LONG, { cause: error });
    throw new Error(
      `The model couldn't judge the content: ${describe(error)}`,
      {
        cause: error,
      },
    );
  }
  return {
    results: assertions.map((assertion, i) => {
      const probability = answers[`a${i}`].noul;
      return {
        assertion,
        verdict: verdict(probability, pass, fail),
        probability,
      };
    }),
  };
}

export function verdict(
  probability: number,
  pass: number,
  fail: number,
): Verdict {
  if (probability >= pass) return "pass";
  if (probability <= fail) return "fail";
  return "unsure";
}

/** A key passed in wins over the environment; of two keys, the AI Gateway's wins. */
function modelClient(options: CheckOptions): TypeSafeClient {
  const given = options.aiGatewayApiKey || options.typesafeApiKey;
  const gateway = given ? options.aiGatewayApiKey : env("AI_GATEWAY_API_KEY");
  const typesafe = given ? options.typesafeApiKey : env("TYPESAFE_API_KEY");
  if (gateway) {
    return new TypeSafeClient({
      apiKey: gateway,
      baseURL: GATEWAY_BASE_URL,
      defaultModel: GATEWAY_MODEL,
      ...CLIENT_SETTINGS,
    });
  }
  if (typesafe) {
    // Explicit, so a TYPESAFE_BASE_URL or TYPESAFE_DEFAULT_MODEL meant for something else doesn't redirect it.
    return new TypeSafeClient({
      apiKey: typesafe,
      baseURL: "https://api.typesafe.ai",
      defaultModel: "jev-latest",
      ...CLIENT_SETTINGS,
    });
  }
  throw new GuardrailsError(
    "A key is needed to reach the model: set AI_GATEWAY_API_KEY (Vercel AI Gateway) or TYPESAFE_API_KEY (TypeSafe).",
  );
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function tooLong(error: unknown): boolean {
  return (
    error instanceof APIError &&
    JSON.stringify(error.body ?? "").includes("max_tokens_exceeded")
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

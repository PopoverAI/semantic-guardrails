import { APIError, TypeSafeClient, type NoulQuestion } from "@typesafe-ai/sdk";
import { type Guardrails, GuardrailsError, loadGuardrails } from "./guardrails.js";

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
  /** Whether the end of the content was left out to fit what the model can judge. */
  truncated: boolean;
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

/** What Jev judges in one request: the content plus the longest assertion. */
const MODEL_TOKEN_LIMIT = 32_000;
/** Room left for what the request adds around the content. */
const REQUEST_OVERHEAD_TOKENS = 1_000;
/**
 * Characters per token, set below what Jev measured (3.8 for English prose and
 * for code) so the estimate errs toward cutting a little early.
 */
const CHARS_PER_TOKEN = 3;
/** When the model still finds the content too long, keep this share of it and try again. */
const SHRINK = 0.7;
/** Errors are reported in the rejection, not logged; a full-length request gets time to finish. */
const CLIENT_SETTINGS = { logLevel: "off", timeout: 60_000 } as const;
const MAX_SHRINKS = 5;

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
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  if (text === undefined || text.trim() === "") {
    throw new GuardrailsError("The content is empty, so there is nothing to judge.");
  }
  const client = modelClient(options);

  const longest = Math.max(...assertions.map((a) => a.length));
  const budget = (MODEL_TOKEN_LIMIT - REQUEST_OVERHEAD_TOKENS) * CHARS_PER_TOKEN - longest;
  let state = text.length > budget ? text.slice(0, budget) : text;

  const questions: Record<string, NoulQuestion> = {};
  assertions.forEach((assertion, i) => {
    questions[`a${i}`] = { type: "noul", instructions: assertion };
  });

  for (let shrinks = 0; ; shrinks++) {
    try {
      const { answers } = await client.systemOne({ state, questions });
      return {
        results: assertions.map((assertion, i) => {
          const probability = answers[`a${i}`].noul;
          return { assertion, verdict: verdict(probability, pass, fail), probability };
        }),
        truncated: state.length < text.length,
      };
    } catch (error) {
      if (tooLong(error) && shrinks < MAX_SHRINKS) {
        state = state.slice(0, Math.floor(state.length * SHRINK));
        continue;
      }
      throw new Error(`The model couldn't judge the content: ${describe(error)}`, {
        cause: error,
      });
    }
  }
}

export function verdict(probability: number, pass: number, fail: number): Verdict {
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
  return error instanceof APIError && JSON.stringify(error.body ?? "").includes("max_tokens_exceeded");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

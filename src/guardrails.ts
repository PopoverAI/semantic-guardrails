import { readFile } from "node:fs/promises";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

/** Guardrails as a file holds them: assertions, and the probabilities that decide a verdict. */
export interface Guardrails {
  /** Statements that hold when the content is right. */
  assertions: string[];
  /** A probability at or above this passes. Defaults to 0.75. */
  pass?: number;
  /** A probability at or below this fails. Defaults to 0.25. */
  fail?: number;
}

/** Guardrails with the defaults filled in. */
export interface ResolvedGuardrails {
  assertions: string[];
  pass: number;
  fail: number;
}

export const DEFAULT_PASS = 0.75;
export const DEFAULT_FAIL = 0.25;

const SETTINGS = new Set(["assertions", "pass", "fail"]);

/** Guardrails that can't be checked: the message says why. */
export class GuardrailsError extends Error {
  override name = "GuardrailsError";
}

/** Read guardrails from a YAML file at `path`, or check guardrails given as an object. */
export async function loadGuardrails(
  source: string | Guardrails,
): Promise<ResolvedGuardrails> {
  if (typeof source !== "string") return resolve(source, "The guardrails");
  let text: string;
  try {
    text = await readFile(source, "utf8");
  } catch (error) {
    throw new GuardrailsError(
      `Couldn't read the guardrails file ${source}: ${(error as Error).message}`,
    );
  }
  return parseGuardrails(text, source);
}

/** Parse guardrails from YAML text; `name` says where it came from in messages. */
export function parseGuardrails(text: string, name: string): ResolvedGuardrails {
  const doc = parseDocument(text);
  const [problem] = doc.errors;
  if (problem) {
    const at = problem.linePos?.[0];
    const where = at ? ` at line ${at.line}, column ${at.col}` : "";
    throw new GuardrailsError(
      `${name} is not valid YAML${where}: ${firstLine(problem.message)}`,
    );
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new GuardrailsError(`${name} must be a mapping with an \`assertions\` list.`);
  }
  // Read assertions node by node, so a non-text entry is caught before YAML turns it into something else.
  const assertions = doc.get("assertions");
  if (isSeq(assertions)) {
    assertions.items.forEach((item, i) => {
      if (!isScalar(item) || typeof item.value !== "string") {
        throw new GuardrailsError(
          `${name}: assertion ${i + 1} is not text. Write each assertion as a line of text.`,
        );
      }
    });
  }
  return resolve((doc.toJS() ?? {}) as Guardrails, name);
}

function resolve(raw: unknown, name: string): ResolvedGuardrails {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new GuardrailsError(`${name} must be a mapping with an \`assertions\` list.`);
  }
  const settings = raw as Record<string, unknown>;
  for (const key of Object.keys(settings)) {
    if (!SETTINGS.has(key)) {
      throw new GuardrailsError(
        `${name} has an unknown setting, \`${key}\`. The settings are \`assertions\`, \`pass\` and \`fail\`.`,
      );
    }
  }

  const assertions = settings.assertions;
  if (assertions === undefined || assertions === null || (Array.isArray(assertions) && assertions.length === 0)) {
    throw new GuardrailsError(`${name} has no assertions, so there is nothing to check.`);
  }
  if (!Array.isArray(assertions)) {
    throw new GuardrailsError(`${name}: \`assertions\` must be a list.`);
  }
  const texts = assertions.map((assertion, i) => {
    if (typeof assertion !== "string" || assertion.trim() === "") {
      throw new GuardrailsError(
        `${name}: assertion ${i + 1} is not text. Write each assertion as a line of text.`,
      );
    }
    return assertion.trim();
  });

  const pass = threshold(settings.pass, "pass", DEFAULT_PASS, name);
  const fail = threshold(settings.fail, "fail", DEFAULT_FAIL, name);
  if (fail >= pass) {
    throw new GuardrailsError(
      `${name}: \`fail\` (${fail}) must be below \`pass\` (${pass}).`,
    );
  }
  return { assertions: texts, pass, fail };
}

function threshold(
  value: unknown,
  setting: "pass" | "fail",
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new GuardrailsError(`${name}: \`${setting}\` must be a number from 0 to 1.`);
  }
  if (value < 0 || value > 1) {
    throw new GuardrailsError(
      `${name}: \`${setting}\` is ${value}, but must be from 0 to 1.`,
    );
  }
  return value;
}

/** The message's first line, less the position the YAML parser appends to it. */
function firstLine(text: string): string {
  return text.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "").trim();
}

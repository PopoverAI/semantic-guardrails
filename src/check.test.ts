import { requirement } from "@popoverai/dotrequirements/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "./check.js";
import { fakeModel, gatewayKeyOnly, guardrailsFile } from "./testing/fake-model.js";

const SPEC = "# Saved searches\n\nSaved searches are for support agents.";
const ONE = { assertions: ["The spec names who the feature is for."] };

beforeEach(gatewayKeyOnly);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected check to reject");
    },
    (e: Error) => e,
  );
}

describe(requirement("GUARD-3"), () => {
  const thresholds = { pass: 0.8, fail: 0.3 };

  it(requirement("GUARD-3.0"), async () => {
    fakeModel({ probabilities: [0.8, 0.95] });
    const { results } = await check({ ...thresholds, assertions: ["A.", "B."] }, SPEC);
    expect(results.map((r) => r.verdict)).toEqual(["pass", "pass"]);
  });

  it(requirement("GUARD-3.1"), async () => {
    fakeModel({ probabilities: [0.3, 0.02] });
    const { results } = await check({ ...thresholds, assertions: ["A.", "B."] }, SPEC);
    expect(results.map((r) => r.verdict)).toEqual(["fail", "fail"]);
  });

  it(requirement("GUARD-3.2"), async () => {
    fakeModel({ probabilities: [0.31, 0.79] });
    const { results } = await check({ ...thresholds, assertions: ["A.", "B."] }, SPEC);
    expect(results.map((r) => r.verdict)).toEqual(["unsure", "unsure"]);
  });

  it(requirement("GUARD-3.3"), async () => {
    fakeModel({ probabilities: [0.42] });
    const { results } = await check(ONE, SPEC);
    expect(results[0].probability).toBe(0.42);
  });
});

describe(requirement("GUARD-4"), () => {
  it(requirement("GUARD-4.0"), async () => {
    const sent = fakeModel({ probabilities: [0.9, 0.9] });
    // a folded block scalar ends in a newline; the quoted entry has spaces on both sides
    const file = guardrailsFile(`assertions:
  - >
    Every requirement says what the user sees
    when it fails.
  - "  The spec names who the feature is for.  "
`);
    await check(file, SPEC);
    // each question is the assertion and its type, with nothing else added
    expect(Object.values(sent[0].questions)).toEqual([
      { type: "noul", instructions: "Every requirement says what the user sees when it fails." },
      { type: "noul", instructions: "The spec names who the feature is for." },
    ]);
  });
});

it(requirement("GUARD-5"), async () => {
  const sent = fakeModel({ probabilities: [0.9, 0.1, 0.5, 0.8, 0.2] });
  const { results } = await check({ assertions: ["A.", "B.", "C.", "D.", "E."] }, SPEC);
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0].questions)).toHaveLength(5);
  expect(results).toHaveLength(5);
});

/** Jev's refusal of content too long to judge, as the AI Gateway relays it. */
const TOO_LONG = {
  status: 400,
  body: { error: { message: '{"error_type":"max_tokens_exceeded"}' } },
};

describe(requirement("GUARD-6"), () => {
  it(requirement("GUARD-6.0"), async () => {
    // about 60,000 tokens, nearly twice what Jev judges in one request: sent whole, once, and not again after the refusal
    const sent = fakeModel(TOO_LONG, { probabilities: [0.9] });
    const content = "The spec names who the feature is for. ".repeat(6_000);
    await check(ONE, content).catch(() => {});
    expect(sent).toHaveLength(1);
    expect(sent[0].state).toBe(content);
  });

  it(requirement("GUARD-6.1"), async () => {
    fakeModel(TOO_LONG);
    await expect(check(ONE, "Saved searches are for support agents. ".repeat(6_000))).rejects.toThrow();
  });

  it(requirement("GUARD-6.2"), async () => {
    fakeModel(TOO_LONG);
    const error = await rejection(check(ONE, "Saved searches are for support agents. ".repeat(6_000)));
    expect(error.message).toMatch(
      /content and assertions together are more than the model can judge in one request \(about 32,000 tokens for Jev\)/,
    );
  });
});

describe(requirement("GUARD-7"), () => {
  it(requirement("GUARD-7.0"), async () => {
    const sent = fakeModel({ probabilities: [0.9] });
    for (const empty of ["", "  \n\t"]) {
      const error = await rejection(check(ONE, empty));
      expect(error.message).toMatch(/content is empty.*nothing to judge/);
    }
    expect(sent).toHaveLength(0);
  });
});

describe(requirement("GUARD-8"), () => {
  it(requirement("GUARD-8.0"), async () => {
    const sent = fakeModel({ probabilities: [0.9] });
    await check(ONE, SPEC);
    expect(sent[0].url).toBe("https://ai-gateway.vercel.sh/typesafe/v1/systemone");
    expect(sent[0].model).toBe("typesafe-ai/jev");
    expect(sent[0].authorization).toBe("Bearer gateway-key");
  });

  it(requirement("GUARD-8.1"), async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
    const sent = fakeModel({ probabilities: [0.9] });
    await check(ONE, SPEC);
    expect(sent[0].url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(sent[0].model).toBe("jev-latest");
    expect(sent[0].authorization).toBe("Bearer typesafe-key");
  });

  it(requirement("GUARD-8.2"), async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
    const sent = fakeModel({ probabilities: [0.9] });
    await check(ONE, SPEC);
    expect(sent[0].url).toMatch(/^https:\/\/ai-gateway\.vercel\.sh\//);
    expect(sent[0].authorization).toBe("Bearer gateway-key");
  });

  it(requirement("GUARD-8.3"), async () => {
    const sent = fakeModel({ probabilities: [0.9] });
    // the environment holds a Gateway key, but a TypeSafe key is passed in
    await check(ONE, SPEC, { typesafeApiKey: "passed-key" });
    expect(sent[0].url).toMatch(/^https:\/\/api\.typesafe\.ai\//);
    expect(sent[0].authorization).toBe("Bearer passed-key");
  });

  it(`${requirement("GUARD-8.3")}: a passed AI Gateway key`, async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "typesafe-key");
    const sent = fakeModel({ probabilities: [0.9] });
    await check(ONE, SPEC, { aiGatewayApiKey: "passed-gateway" });
    expect(sent[0].url).toBe("https://ai-gateway.vercel.sh/typesafe/v1/systemone");
    expect(sent[0].authorization).toBe("Bearer passed-gateway");
  });

  it(requirement("GUARD-8.4"), async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const sent = fakeModel({ probabilities: [0.9] });
    const error = await rejection(check(ONE, SPEC));
    expect(error.message).toMatch(/key is needed.*AI_GATEWAY_API_KEY.*TYPESAFE_API_KEY/);
    expect(sent).toHaveLength(0);
  });

  it(`${requirement("GUARD-8.5")}: a refused request`, async () => {
    fakeModel({ status: 401, body: { error: { message: "Invalid API key" } } });
    const error = await rejection(check(ONE, SPEC));
    expect(error.message).toMatch(/model couldn't judge the content/);
    expect(error.message).toMatch(/401|Invalid API key/);
  });

  it(`${requirement("GUARD-8.5")}: an unreachable model`, async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const error = await rejection(check(ONE, SPEC));
    expect(error.message).toMatch(/model couldn't judge the content/);
    expect(error.message).toMatch(/Connection error|fetch failed/);
  });
});

describe(requirement("GUARD-9"), () => {
  it(requirement("GUARD-9.0.0"), async () => {
    fakeModel({ probabilities: [0.9] });
    const file = guardrailsFile("assertions:\n  - The spec names who the feature is for.\n");
    const { results } = await check(file, SPEC);
    expect(results[0].assertion).toBe("The spec names who the feature is for.");
  });

  it(requirement("GUARD-9.0.1"), async () => {
    fakeModel({ probabilities: [0.85] });
    const { results } = await check({ assertions: ["A."], pass: 0.9 }, SPEC);
    expect(results[0].verdict).toBe("unsure");
  });

  it(requirement("GUARD-9.1.0"), async () => {
    const sent = fakeModel({ probabilities: [0.9] });
    await check(ONE, SPEC);
    expect(sent[0].state).toBe(SPEC);
  });

  it(requirement("GUARD-9.1.1"), async () => {
    const sent = fakeModel({ probabilities: [0.9] });
    const ticket = { subject: "Charged twice", messages: ["Please refund one."] };
    await check(ONE, ticket);
    expect(typeof sent[0].state).toBe("string");
    expect(JSON.parse(sent[0].state as string)).toEqual(ticket);
  });

  it(requirement("GUARD-9.2"), async () => {
    fakeModel({ probabilities: [0.1, 0.5, 0.9] });
    const result = await check({ assertions: ["C.", "A.", "B."] }, SPEC);
    expect(result).toEqual({
      results: [
        { assertion: "C.", verdict: "fail", probability: 0.1 },
        { assertion: "A.", verdict: "unsure", probability: 0.5 },
        { assertion: "B.", verdict: "pass", probability: 0.9 },
      ],
    });
  });

  it(requirement("GUARD-9.3"), async () => {
    fakeModel({ probabilities: [0.9] });
    // refused guardrails, empty content and a missing key each reject with why
    await expect(check({ assertions: [] }, SPEC)).rejects.toThrow(/nothing to check/);
    await expect(check(ONE, "")).rejects.toThrow(/nothing to judge/);
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    await expect(check(ONE, SPEC)).rejects.toThrow(/key is needed/);
  });
});

import { requirement } from "@popoverai/dotrequirements/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "./check.js";
import {
  fakeModel,
  gatewayKeyOnly,
  guardrailsFile,
} from "./testing/fake-model.js";

const SPEC = "# Saved searches\n\nSaved searches are for support agents.";

beforeEach(gatewayKeyOnly);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe(requirement("GUARD-1"), () => {
  it(requirement("GUARD-1.0"), async () => {
    // two entries, two independent verdicts
    fakeModel({ probabilities: [0.9, 0.1] });
    const file = guardrailsFile(`assertions:
  - The spec names who the feature is for.
  - The spec names a success metric.
`);
    const { results } = await check(file, SPEC);
    expect(results).toEqual([
      {
        assertion: "The spec names who the feature is for.",
        verdict: "pass",
        probability: 0.9,
      },
      {
        assertion: "The spec names a success metric.",
        verdict: "fail",
        probability: 0.1,
      },
    ]);
  });

  it(requirement("GUARD-1.1"), async () => {
    fakeModel({ probabilities: [0.8] });
    const file = guardrailsFile(
      "pass: 0.9\nassertions:\n  - The spec names who the feature is for.\n",
    );
    const { results } = await check(file, SPEC);
    expect(results[0].verdict).toBe("unsure");
  });

  it(requirement("GUARD-1.2"), async () => {
    fakeModel({ probabilities: [0.2] });
    const file = guardrailsFile(
      "fail: 0.1\nassertions:\n  - The spec names who the feature is for.\n",
    );
    const { results } = await check(file, SPEC);
    expect(results[0].verdict).toBe("unsure");
  });

  it(requirement("GUARD-1.3"), async () => {
    // 0.75 and 0.25 are on the boundary of each default, so they show where it sits
    fakeModel({ probabilities: [0.75, 0.74, 0.25, 0.26] });
    const file = guardrailsFile(`assertions:
  - First.
  - Second.
  - Third.
  - Fourth.
`);
    const { results } = await check(file, SPEC);
    expect(results.map((r) => r.verdict)).toEqual([
      "pass",
      "unsure",
      "fail",
      "unsure",
    ]);
  });
});

describe(requirement("GUARD-2"), () => {
  /** Checks `yaml` and returns the rejection's message, asserting the model was never asked. */
  async function refusal(yaml: string): Promise<string> {
    const sent = fakeModel({ probabilities: [0.9] });
    const error = await check(guardrailsFile(yaml), SPEC).then(
      () => {
        throw new Error("expected the guardrails to be refused");
      },
      (e: Error) => e,
    );
    expect(sent).toHaveLength(0);
    return error.message;
  }

  it(requirement("GUARD-2.0"), async () => {
    expect(await refusal("pass: 0.8\n")).toMatch(
      /no assertions.*nothing to check/,
    );
    expect(await refusal("assertions: []\n")).toMatch(
      /no assertions.*nothing to check/,
    );
  });

  it(requirement("GUARD-2.1"), async () => {
    expect(await refusal('pass: "high"\nassertions:\n  - A.\n')).toMatch(
      /`pass` must be a number/,
    );
    expect(await refusal("fail: [0.2]\nassertions:\n  - A.\n")).toMatch(
      /`fail` must be a number/,
    );
  });

  it(requirement("GUARD-2.2"), async () => {
    expect(await refusal("pass: 1.5\nassertions:\n  - A.\n")).toMatch(
      /`pass` is 1.5, but must be from 0 to 1/,
    );
    expect(await refusal("fail: -0.1\nassertions:\n  - A.\n")).toMatch(
      /`fail` is -0.1, but must be from 0 to 1/,
    );
  });

  it(requirement("GUARD-2.3"), async () => {
    expect(
      await refusal("pass: 0.5\nfail: 0.5\nassertions:\n  - A.\n"),
    ).toMatch(/`fail` \(0.5\) must be below `pass` \(0.5\)/);
    // fail set above the default pass of 0.75
    expect(await refusal("fail: 0.8\nassertions:\n  - A.\n")).toMatch(
      /`fail` \(0.8\) must be below `pass` \(0.75\)/,
    );
  });

  it(requirement("GUARD-2.4"), async () => {
    expect(await refusal("assertions:\n  - A.\n bad: [unclosed\n")).toMatch(
      /not valid YAML at line 3, column \d+/,
    );
  });

  it(requirement("GUARD-2.5"), async () => {
    expect(await refusal("assertions:\n  - A.\n  - 42\n")).toMatch(
      /assertion 2 is not text/,
    );
    expect(
      await refusal("assertions:\n  - A.\n  - B.\n  - { nested: thing }\n"),
    ).toMatch(/assertion 3 is not text/);
  });

  it(requirement("GUARD-2.6"), async () => {
    expect(await refusal("pas: 0.9\nassertions:\n  - A.\n")).toMatch(
      /unknown setting, `pas`/,
    );
  });
});

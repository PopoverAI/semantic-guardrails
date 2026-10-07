import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { requirement } from "@popoverai/dotrequirements/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";
import { contentFile, fakeModel, gatewayKeyOnly, guardrailsFile } from "./testing/fake-model.js";

const GUARDRAILS = `assertions:
  - The spec names who the feature is for.
  - The spec states a success metric.
  - Every requirement says what the user sees when it fails.
`;

beforeEach(gatewayKeyOnly);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Run the command as Sam would, with `stdin` piped in (null for a terminal). */
async function sam(argv: string[], stdin: string | null = null) {
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    readStdin: async () => stdin,
  });
  return { code, stdout, stderr };
}

describe(requirement("GUARD-10"), () => {
  it(requirement("GUARD-10.0"), async () => {
    const sent = fakeModel({ probabilities: [0.9, 0.9, 0.9] });
    // relative paths, as Sam would type them, so a marker that resolved them would differ
    const spec = relative(process.cwd(), contentFile("spec.md", "# Spec\nFor support agents."));
    const pitch = relative(process.cwd(), contentFile("pitch.md", "# Pitch\nCut replies to an hour."));
    await sam(["check", guardrailsFile(GUARDRAILS), pitch, spec]);
    const state = sent[0].state as string;
    expect(state).toContain(`--- ${pitch} ---\n# Pitch\nCut replies to an hour.`);
    expect(state).toContain(`--- ${spec} ---\n# Spec\nFor support agents.`);
    expect(state.indexOf(pitch)).toBeLessThan(state.indexOf(spec));
  });

  it(requirement("GUARD-10.1"), async () => {
    const sent = fakeModel({ probabilities: [0.9, 0.9, 0.9] });
    await sam(["check", guardrailsFile(GUARDRAILS)], "# Spec from a pipe");
    expect(sent[0].state).toBe("# Spec from a pipe");
  });

  it(requirement("GUARD-10.2"), async () => {
    const sent = fakeModel({ probabilities: [0.9, 0.9, 0.9] });
    const { code, stderr } = await sam(["check", guardrailsFile(GUARDRAILS)], null);
    expect(stderr).toMatch(/Name files to check, or pipe content in/);
    expect(code).toBe(2);
    expect(sent).toHaveLength(0);
  });

  it(requirement("GUARD-10.3"), async () => {
    // unsure comes before fail in the file, so the report keeps the file's order rather than putting fails first
    fakeModel({ probabilities: [0.5, 0.123, 0.9] });
    const { stdout } = await sam(["check", guardrailsFile(GUARDRAILS)], "# Spec");
    expect(stdout).toBe(
      [
        "UNSURE  0.50  The spec names who the feature is for.",
        "FAIL    0.12  The spec states a success metric.",
        "1 of 3 assertions passed.",
        "",
      ].join("\n"),
    );
  });

  it(requirement("GUARD-10.4"), async () => {
    fakeModel({ probabilities: [0.9, 0.8, 0.99] });
    const { stdout } = await sam(["check", guardrailsFile(GUARDRAILS)], "# Spec");
    expect(stdout).toBe("3 of 3 assertions passed.\n");
  });

  it(requirement("GUARD-10.5"), async () => {
    fakeModel({ probabilities: [0.9, 0.1, 0.5] });
    const { stdout } = await sam(["check", guardrailsFile(GUARDRAILS), "--json"], "# Spec");
    expect(JSON.parse(stdout)).toEqual({
      results: [
        { assertion: "The spec names who the feature is for.", verdict: "pass", probability: 0.9 },
        { assertion: "The spec states a success metric.", verdict: "fail", probability: 0.1 },
        {
          assertion: "Every requirement says what the user sees when it fails.",
          verdict: "unsure",
          probability: 0.5,
        },
      ],
      truncated: false,
    });
  });

  it(requirement("GUARD-10.6"), async () => {
    fakeModel({ probabilities: [0.9, 0.9, 0.9] });
    const long = "For support agents. ".repeat(10_000);
    const { stdout, stderr } = await sam(["check", guardrailsFile(GUARDRAILS), "--json"], long);
    expect(stderr).toMatch(/too long.*cut off/);
    // the notice stays out of standard output, so the JSON still parses
    expect(JSON.parse(stdout).truncated).toBe(true);
  });
});

describe(requirement("GUARD-11"), () => {
  it(requirement("GUARD-11.0"), async () => {
    fakeModel({ probabilities: [0.9, 0.5, 0.6] });
    const { code } = await sam(["check", guardrailsFile(GUARDRAILS)], "# Spec");
    expect(code).toBe(0);
  });

  it(requirement("GUARD-11.1"), async () => {
    fakeModel({ probabilities: [0.9, 0.1, 0.6] });
    const { code } = await sam(["check", guardrailsFile(GUARDRAILS)], "# Spec");
    expect(code).toBe(1);
  });

  it(requirement("GUARD-11.2"), async () => {
    fakeModel({ probabilities: [0.9, 0.9, 0.9] });
    const long = "For support agents. ".repeat(10_000);
    const passing = await sam(["check", guardrailsFile(GUARDRAILS)], long);
    expect(passing.stderr).toMatch(/cut off/);
    expect(passing.code).toBe(0);
    fakeModel({ probabilities: [0.9, 0.1, 0.9] });
    const failing = await sam(["check", guardrailsFile(GUARDRAILS)], long);
    expect(failing.code).toBe(1);
  });

  describe(requirement("GUARD-11.3"), () => {
    it(requirement("GUARD-11.3.0"), async () => {
      fakeModel({ probabilities: [0.9] });
      const missing = await sam(["check", "/no/such/guardrails.yaml"], "# Spec");
      expect(missing.code).toBe(2);
      expect(missing.stderr).toMatch(/Couldn't read the guardrails file/);
      const refused = await sam(["check", guardrailsFile("assertions: []\n")], "# Spec");
      expect(refused.code).toBe(2);
      expect(refused.stderr).toMatch(/nothing to check/);
    });

    it(requirement("GUARD-11.3.1"), async () => {
      fakeModel({ probabilities: [0.9, 0.9, 0.9] });
      const { code, stderr } = await sam(["check", guardrailsFile(GUARDRAILS), "/no/such/spec.md"]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/Couldn't read \/no\/such\/spec\.md/);
    });

    it(requirement("GUARD-11.3.2"), async () => {
      const sent = fakeModel({ probabilities: [0.9, 0.9, 0.9] });
      expect((await sam(["check", guardrailsFile(GUARDRAILS)], "")).code).toBe(2);
      const empty = contentFile("empty.md", "\n");
      expect((await sam(["check", guardrailsFile(GUARDRAILS), empty])).code).toBe(2);
      expect(sent).toHaveLength(0);
    });

    it(requirement("GUARD-11.3.3"), async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "");
      fakeModel({ probabilities: [0.9, 0.9, 0.9] });
      const { code, stderr } = await sam(["check", guardrailsFile(GUARDRAILS)], "# Spec");
      expect(code).toBe(2);
      expect(stderr).toMatch(/key is needed/);
    });

    it(requirement("GUARD-11.3.4"), async () => {
      fakeModel({ status: 403, body: { error: { message: "Forbidden" } } });
      const { code, stderr } = await sam(["check", guardrailsFile(GUARDRAILS)], "# Spec");
      expect(code).toBe(2);
      expect(stderr).toMatch(/model couldn't judge the content/);
    });

    it(requirement("GUARD-11.3.5"), async () => {
      fakeModel({ probabilities: [0.9, 0.9, 0.9] });
      expect((await sam(["check"], "# Spec")).stderr).toMatch(/Usage: semantic-guardrails check/);
      expect((await sam(["check"], "# Spec")).code).toBe(2);
      expect((await sam([], "# Spec")).code).toBe(2);
      expect((await sam(["lint", guardrailsFile(GUARDRAILS)], "# Spec")).code).toBe(2);
      expect((await sam(["check", guardrailsFile(GUARDRAILS), "--verbose"], "# Spec")).code).toBe(2);
    });
  });
});

it(`${requirement("GUARD-11.3.5")}, as the process's own exit status`, () => {
  // the built command, as a script or CI would run it; `npm test` builds first
  const result = spawnSync(process.execPath, ["dist/bin.js"], { encoding: "utf8" });
  expect(result.stderr).toMatch(/Usage: semantic-guardrails check/);
  expect(result.status).toBe(2);
});

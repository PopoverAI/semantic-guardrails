import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { requirement } from "@popoverai/dotrequirements/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";
import {
  contentFile,
  fakeModel,
  gatewayKeyOnly,
  guardrailsFile,
  tooLongRefusal,
} from "./testing/fake-model.js";

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
    const spec = relative(
      process.cwd(),
      contentFile("spec.md", "# Spec\nFor support agents."),
    );
    const pitch = relative(
      process.cwd(),
      contentFile("pitch.md", "# Pitch\nCut replies to an hour."),
    );
    await sam(["check", guardrailsFile(GUARDRAILS), pitch, spec]);
    const state = sent[0].state as string;
    expect(state).toContain(
      `--- ${pitch} ---\n# Pitch\nCut replies to an hour.`,
    );
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
    const { code, stderr } = await sam(
      ["check", guardrailsFile(GUARDRAILS)],
      null,
    );
    expect(stderr).toMatch(/Name files to check, or pipe content in/);
    expect(code).toBe(2);
    expect(sent).toHaveLength(0);
  });

  it(requirement("GUARD-10.3"), async () => {
    // unsure comes before fail in the file, so the report keeps the file's order rather than putting fails first
    fakeModel({ probabilities: [0.5, 0.123, 0.9] });
    const { stdout } = await sam(
      ["check", guardrailsFile(GUARDRAILS)],
      "# Spec",
    );
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
    const { stdout } = await sam(
      ["check", guardrailsFile(GUARDRAILS)],
      "# Spec",
    );
    expect(stdout).toBe("3 of 3 assertions passed.\n");
  });

  it(requirement("GUARD-10.5"), async () => {
    fakeModel({ probabilities: [0.9, 0.1, 0.5] });
    const { stdout } = await sam(
      ["check", guardrailsFile(GUARDRAILS), "--json"],
      "# Spec",
    );
    expect(JSON.parse(stdout)).toEqual({
      results: [
        {
          assertion: "The spec names who the feature is for.",
          verdict: "pass",
          probability: 0.9,
        },
        {
          assertion: "The spec states a success metric.",
          verdict: "fail",
          probability: 0.1,
        },
        {
          assertion: "Every requirement says what the user sees when it fails.",
          verdict: "unsure",
          probability: 0.5,
        },
      ],
    });
  });

  it(requirement("GUARD-10.6"), async () => {
    const guardrails = guardrailsFile(GUARDRAILS);
    const ways: Array<[string, () => void, string[], string | null]> = [
      [
        "too long",
        () => fakeModel(tooLongRefusal),
        ["check", guardrails],
        "# Spec",
      ],
      [
        "unreadable file",
        () => fakeModel({ probabilities: [0.9, 0.9, 0.9] }),
        ["check", guardrails, "/no/such/spec.md"],
        null,
      ],
      [
        "used wrongly",
        () => fakeModel({ probabilities: [0.9, 0.9, 0.9] }),
        ["check"],
        "# Spec",
      ],
      [
        "no key",
        () => {
          fakeModel({ probabilities: [0.9, 0.9, 0.9] });
          vi.stubEnv("AI_GATEWAY_API_KEY", "");
        },
        ["check", guardrails],
        "# Spec",
      ],
    ];
    for (const [way, arrange, argv, stdin] of ways) {
      for (const json of [false, true]) {
        arrange();
        const { stdout, stderr } = await sam(
          json ? [...argv, "--json"] : argv,
          stdin,
        );
        expect(stderr, `${way}${json ? " with --json" : ""}`).not.toBe("");
        expect(stdout, `${way}${json ? " with --json" : ""}`).toBe("");
      }
    }
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

  describe(requirement("GUARD-11.2"), () => {
    it(requirement("GUARD-11.2.0"), async () => {
      fakeModel({ probabilities: [0.9] });
      const missing = await sam(
        ["check", "/no/such/guardrails.yaml"],
        "# Spec",
      );
      expect(missing.code).toBe(2);
      expect(missing.stderr).toMatch(/Couldn't read the guardrails file/);
      const refused = await sam(
        ["check", guardrailsFile("assertions: []\n")],
        "# Spec",
      );
      expect(refused.code).toBe(2);
      expect(refused.stderr).toMatch(/nothing to check/);
    });

    it(requirement("GUARD-11.2.1"), async () => {
      fakeModel({ probabilities: [0.9, 0.9, 0.9] });
      const { code, stderr } = await sam([
        "check",
        guardrailsFile(GUARDRAILS),
        "/no/such/spec.md",
      ]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/Couldn't read \/no\/such\/spec\.md/);
    });

    it(requirement("GUARD-11.2.2"), async () => {
      const sent = fakeModel({ probabilities: [0.9, 0.9, 0.9] });
      expect((await sam(["check", guardrailsFile(GUARDRAILS)], "")).code).toBe(
        2,
      );
      const empty = contentFile("empty.md", "\n");
      expect(
        (await sam(["check", guardrailsFile(GUARDRAILS), empty])).code,
      ).toBe(2);
      expect(sent).toHaveLength(0);
    });

    it(requirement("GUARD-11.2.3"), async () => {
      fakeModel(tooLongRefusal);
      const { code, stderr } = await sam(
        ["check", guardrailsFile(GUARDRAILS)],
        "# Spec",
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/more than the model can judge in one request/);
    });

    it(requirement("GUARD-11.2.4"), async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "");
      fakeModel({ probabilities: [0.9, 0.9, 0.9] });
      const { code, stderr } = await sam(
        ["check", guardrailsFile(GUARDRAILS)],
        "# Spec",
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/key is needed/);
    });

    it(requirement("GUARD-11.2.5"), async () => {
      fakeModel({ status: 403, body: { error: { message: "Forbidden" } } });
      const { code, stderr } = await sam(
        ["check", guardrailsFile(GUARDRAILS)],
        "# Spec",
      );
      expect(code).toBe(2);
      expect(stderr).toMatch(/model couldn't judge the content/);
    });

    it(requirement("GUARD-11.2.6"), async () => {
      fakeModel({ probabilities: [0.9, 0.9, 0.9] });
      expect((await sam(["check"], "# Spec")).stderr).toMatch(
        /Usage: semantic-guardrails check/,
      );
      expect((await sam(["check"], "# Spec")).code).toBe(2);
      expect((await sam([], "# Spec")).code).toBe(2);
      expect(
        (await sam(["lint", guardrailsFile(GUARDRAILS)], "# Spec")).code,
      ).toBe(2);
      expect(
        (
          await sam(
            ["check", guardrailsFile(GUARDRAILS), "--verbose"],
            "# Spec",
          )
        ).code,
      ).toBe(2);
    });
  });
});

it(`${requirement("GUARD-11.2.6")}, as the process's own exit status`, () => {
  // the built command, as a script or CI would run it; `npm test` builds first
  const result = spawnSync(process.execPath, ["dist/bin.js"], {
    encoding: "utf8",
  });
  expect(result.stderr).toMatch(/Usage: semantic-guardrails check/);
  expect(result.status).toBe(2);
});

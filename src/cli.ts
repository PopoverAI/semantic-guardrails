import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { type CheckResult, check } from "./check.js";

/** What the command reads and writes, so it runs the same in a test as in a shell. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Standard input, read in full; null when it is a terminal. */
  readStdin: () => Promise<string | null>;
}

const USAGE = `Usage: semantic-guardrails check <guardrails.yaml> [files...] [--json]

Checks the files, joined in the order named, against the assertions in the
guardrails file. With no files named, checks standard input.

Needs AI_GATEWAY_API_KEY (Vercel AI Gateway) or TYPESAFE_API_KEY (TypeSafe).

Exit codes: 0 when nothing fails (unsure is allowed), 1 when an assertion
fails, 2 when it couldn't check.
`;

/** Run the command; resolves to its exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.values.help) {
    io.stdout(USAGE);
    return 0;
  }
  const [command, guardrails, ...files] = args.positionals;
  if (command !== "check" || !guardrails) {
    io.stderr(USAGE);
    return 2;
  }

  let content: string;
  try {
    content = files.length > 0 ? await joinFiles(files) : await fromStdin(io);
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 2;
  }

  let result: CheckResult;
  try {
    result = await check(guardrails, content);
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 2;
  }

  io.stdout(args.values.json ? `${JSON.stringify(result, null, 2)}\n` : report(result));
  return result.results.some((r) => r.verdict === "fail") ? 1 : 0;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}

/** Each file marked with its path as named, in the order named. */
async function joinFiles(paths: string[]): Promise<string> {
  const texts = await Promise.all(
    paths.map(async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        throw new Error(`Couldn't read ${path}: ${(error as Error).message}`);
      }
    }),
  );
  // Only markers around empty files is still nothing to judge.
  if (texts.every((text) => text.trim() === "")) return "";
  return texts.map((text, i) => `--- ${paths[i]} ---\n${text}`).join("\n\n");
}

async function fromStdin(io: Io): Promise<string> {
  const text = await io.readStdin();
  if (text === null) {
    throw new Error(
      "Name files to check, or pipe content in: semantic-guardrails check guardrails.yaml spec.md",
    );
  }
  return text;
}

/** Failed and unsure assertions in the guardrails' order, then how many passed. */
function report({ results }: CheckResult): string {
  const lines = results
    .filter((r) => r.verdict !== "pass")
    .map((r) => `${r.verdict === "fail" ? "FAIL  " : "UNSURE"}  ${r.probability.toFixed(2)}  ${r.assertion}`);
  const passed = results.filter((r) => r.verdict === "pass").length;
  lines.push(`${passed} of ${results.length} assertions passed.`);
  return `${lines.join("\n")}\n`;
}

# semantic-guardrails

Guardrails that check what content means, configured as plain statements in a YAML file.

Some rules can't be written as a pattern: "no function logs a secret", "every requirement says what the user sees when it fails", "the changelog mentions every breaking change". semantic-guardrails lets you write rules like these as assertions, keep them in one file next to what they guard, and check content against them from the command line, in CI or from code. A model judges each assertion, and each one gets a verdict: pass, fail or unsure.

```yaml
# guardrails.yaml
assertions:
  - The spec names who the feature is for.
  - Every requirement says what the user sees when it fails.
  - The document contains no placeholders or unresolved TODOs.
```

```console
$ semantic-guardrails check guardrails.yaml spec.md
UNSURE  0.59  Every requirement says what the user sees when it fails.
FAIL    0.04  The document contains no placeholders or unresolved TODOs.
1 of 3 assertions passed.
```

Rules a program can check for certain, such as whether a file exists or a pattern matches, belong in a linter. semantic-guardrails is for the ones that need judgment.

## Install

```sh
npm install semantic-guardrails
```

Node 20 or later. The model is [TypeSafe's Jev](https://typesafe.ai). Set one key:

- `AI_GATEWAY_API_KEY`, a [Vercel AI Gateway](https://vercel.com/ai-gateway) key, or
- `TYPESAFE_API_KEY`, a TypeSafe API key.

When both are set, the Gateway key is used.

## Writing guardrails

A guardrails file is a list of assertions and, optionally, two thresholds:

```yaml
pass: 0.75  # an assertion passes when the model's probability that it holds is at least this (default 0.75)
fail: 0.25  # and fails when it is at most this (default 0.25)
assertions:
  - No function logs an API key, token or password.
  - Every public function has a doc comment.
```

**Write each assertion as a statement that holds when the content is right,** not as a question, and keep it to one thing. Each is sent to the model exactly as written, with nothing added, so what you read in the file is what is judged.

**Unsure is a verdict of its own.** It's anything between the two thresholds. Hard cases land there: an assertion about every item in a list, a near miss, something written in an unusual way. You decide what unsure means for you. A CI gate that fails only on failures lets unsure through to whoever reviews next. Move the thresholds closer together for fewer unsure verdicts, or further apart to hear about more borderline cases.

**Mistakes in the file are refused, not ignored.** A misspelled setting like `pas: 0.9`, an assertion that isn't text, or thresholds out of order stop the check with a message saying what's wrong, rather than silently falling back to a default.

**A check asks the model about all of a file's assertions together,** so grouping related assertions in one file is cheaper than splitting them across several.

## Command line

```sh
semantic-guardrails check <guardrails.yaml> [files...] [--json]
```

- Named files are checked together, in the order named, each marked with its path. With no files, standard input is checked.
- Failed and unsure assertions are listed with their probabilities, then how many passed.
- `--json` prints `{ results: [{ assertion, verdict, probability }] }` to standard output, and nothing else.
- When it can't check, it says why on standard error and prints nothing to standard output.

| Exit code | Meaning |
|---|---|
| 0 | No assertion failed (some may be unsure) |
| 1 | At least one assertion failed |
| 2 | Couldn't check: an invalid guardrails file, an unreadable or empty input, content too long for the model, no key, or the model unreachable |

### In CI

```yaml
# .github/workflows/guardrails.yml
on: pull_request
jobs:
  guardrails:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx semantic-guardrails check guardrails.yaml docs/spec.md
        env:
          AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
```

## In code

```ts
import { check } from "semantic-guardrails";

const { results } = await check("guardrails.yaml", draft);

for (const { assertion, verdict, probability } of results) {
  if (verdict === "fail") console.log(`Fails: ${assertion} (${probability})`);
}
```

- The guardrails are a file's path, or an object with the same settings: `{ assertions: [...], pass?, fail? }`.
- The content is text, or any JSON value, which is checked as its JSON text.
- A key passed in is used instead of the environment: `check(guardrails, content, { aiGatewayApiKey })` or `{ typesafeApiKey }`.
- `check` rejects with a message saying why when it can't give verdicts.

## Content too long for the model

Content longer than the model can judge in one request is refused, never cut: the check gives no verdicts and says the content is too long. A guardrail that passed on content the model never read would be worse than one that refuses. [TypeSafe's docs](https://docs.typesafe.ai) give the model's limit. To check part of something, choose the part before passing it in.

For code, [Repomix](https://github.com/yamadashy/repomix) packs a smaller version to pipe in: `--compress` keeps signatures and drops function bodies, and `--token-count-tree` shows which files are largest.

```sh
repomix --stdout --compress --include "src/**/*.ts" | semantic-guardrails check guardrails.yaml
```

## License

Apache 2.0

# semantic-guardrails

Guardrails enforced by meaning. Write what must always be true of some content as plain assertions in a YAML file; an evaluation model judges whether each one holds, and each gets a verdict: pass, fail or unsure.

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

It is for invariants that need a model to judge but not an expensive one: checks cheap enough to run on every draft, so the work goes back before a reviewer, human or agent, spends time on it. Checks a program can answer for certain, such as whether a file exists or a pattern matches, belong to a linter.

The model is [TypeSafe's Jev](https://typesafe.ai), which answers yes/no questions about text with a calibrated probability. A check costs one request however many assertions the file holds.

## Install

```sh
npm install semantic-guardrails
```

Node 20 or later.

## Model access

Set one of:

- `AI_GATEWAY_API_KEY`: a [Vercel AI Gateway](https://vercel.com/ai-gateway) key. Jev is reached through the Gateway.
- `TYPESAFE_API_KEY`: a TypeSafe API key. Jev is reached through TypeSafe's own API.

When both are set, the Gateway key is used.

## Writing guardrails

Each entry under `assertions` is a statement that holds when the content is right. Write it as an assertion, not a question, and keep it to one thing: Jev reads it literally, and it is sent exactly as written.

Two optional settings decide the verdict from Jev's probability that an assertion holds:

```yaml
pass: 0.75  # at or above this, the assertion passes (default 0.75)
fail: 0.25  # at or below this, it fails (default 0.25)
assertions:
  - The pitch states a measurable success metric.
```

Anything in between is **unsure**. Unsure is where hard cases land: an assertion about every item in a list, a near miss, a placeholder written in an unusual way. What unsure means is yours to decide; a gate that blocks only failures lets unsure through to whoever reviews next.

A file with an unknown setting is refused, so a misspelling like `pas: 0.9` can't silently fall back to the default.

## Command line

```sh
semantic-guardrails check <guardrails.yaml> [files...] [--json]
```

- Named files are judged together, in the order named, each marked with its path. With no files, standard input is judged.
- Failed and unsure assertions are listed with their probabilities, then how many passed.
- `--json` prints the same object `check` returns, and nothing else, to standard output.
- When it can't check, it says why on standard error and prints nothing to standard output.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | No assertion failed (some may be unsure) |
| 1 | At least one assertion failed |
| 2 | Couldn't check: an invalid guardrails file, an unreadable or empty input, content too long for the model, no key, or the model unreachable |

## In code

```ts
import { check } from "semantic-guardrails";

const { results } = await check("guardrails.yaml", draft);

for (const { assertion, verdict, probability } of results) {
  if (verdict === "fail") console.log(`Fails: ${assertion} (${probability})`);
}
```

- The guardrails are a file's path or an object with the same settings: `{ assertions: [...], pass?, fail? }`.
- The content is text, or any JSON value, which is judged as its JSON text.
- Pass a key to use it instead of the environment: `check(guardrails, content, { aiGatewayApiKey })` or `{ typesafeApiKey }`.
- `check` rejects with a message saying why when it can't give verdicts.

## Long content

Jev judges about 32,000 tokens in one request, assertions included. Content longer than that is refused, not cut: the check gives no verdicts and says the content is too long (exit 2 from the command). A guardrail that passed on content the model never read would be worse than one that refuses. To check part of something, cut it yourself before piping it in.

Jev's tokenizer isn't public, and its refusal doesn't say how far over the limit the content is. OpenAI's `cl100k_base` tokenizer comes within about 20% of Jev's count. Measured against Jev in October 2026:

| Content | Characters per Jev token | Jev's count ÷ `cl100k_base`'s |
|---|---|---|
| English prose | 3.9 | 1.03 |
| Markdown | 3.8 | 1.07 |
| TypeScript | 3.5 | 1.07 |
| JSON | 2.2 | 1.17 |
| Emoji and accented text | 2.5 | 0.83 |
| Japanese | 1.0 | 1.04 |

So to be safe, keep content to about 26,000 `cl100k_base` tokens. (`o200k_base`, the other common tokenizer, was off by as much as 35%.)

### Code

Code files can be named like any others: `semantic-guardrails check guardrails.yaml src/auth.ts src/session.ts`. When there's more code than fits, [Repomix](https://github.com/yamadashy/repomix) can pack a smaller version of it to pipe in, and measure it with `cl100k_base`:

```sh
# See which files are largest
repomix --token-count-tree --token-count-encoding cl100k_base --include "src/**/*.ts"

# Pack a smaller version: --compress keeps signatures and drops function bodies
repomix --stdout --compress --include "src/**/*.ts" | semantic-guardrails check guardrails.yaml
```

Repomix's `--token-budget` makes Repomix itself exit 1 when the pack is over a budget, which can catch a codebase growing toward the limit before Jev refuses it. With `--stdout` it exits without printing why, and in a pipe its exit code is lost unless `pipefail` is set:

```sh
set -o pipefail
repomix --stdout --compress --token-count-encoding cl100k_base --token-budget 26000 \
  | semantic-guardrails check guardrails.yaml
```

## License

Apache 2.0

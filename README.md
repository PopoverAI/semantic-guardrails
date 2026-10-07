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

Exit codes:

| Code | Meaning |
|---|---|
| 0 | No assertion failed (some may be unsure) |
| 1 | At least one assertion failed |
| 2 | Couldn't check: an invalid guardrails file, an unreadable or empty input, no key, or the model unreachable |

## In code

```ts
import { check } from "semantic-guardrails";

const { results, truncated } = await check("guardrails.yaml", draft);

for (const { assertion, verdict, probability } of results) {
  if (verdict === "fail") console.log(`Fails: ${assertion} (${probability})`);
}
```

- The guardrails are a file's path or an object with the same settings: `{ assertions: [...], pass?, fail? }`.
- The content is text, or any JSON value, which is judged as its JSON text.
- Pass a key to use it instead of the environment: `check(guardrails, content, { aiGatewayApiKey })` or `{ typesafeApiKey }`.
- `check` rejects with a message saying why when it can't give verdicts.

## Long content

Jev judges about 32,000 tokens in one request. Content past that is cut from the end, and the result says so (`truncated: true`; a notice on standard error from the command). Cutting the content doesn't change the exit code.

## Checking code

To check a codebase, or part of one, pack it with [Repomix](https://github.com/yamadashy/repomix) and pipe it in. `--compress` keeps signatures and drops function bodies, so more of the code fits before anything is cut:

```sh
repomix --stdout --compress | semantic-guardrails check guardrails.yaml
git diff --name-only main | repomix --stdin --stdout | semantic-guardrails check guardrails.yaml
```

## License

Apache 2.0

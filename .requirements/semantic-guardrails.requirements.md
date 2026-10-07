---
document:
  defaultPrefix: GUARD
---

# semantic-guardrails

Guardrails a model enforces by meaning. Sam, a developer, writes what must always be true of some content as plain assertions in a YAML file. The package asks an evaluation model, such as TypeSafe's Jev, whether each assertion holds, and gives each one a verdict. Checks that a program can answer for certain, such as whether a file exists or a pattern matches, are a linter's job and not this package's.

## The guardrails file

```dotrequirements
GUARD-1: Sam writes guardrails as assertions in a YAML file
  0. → Each entry in the file's `assertions` list is checked as its own assertion, such as "The spec names who the feature is for."
  1. → When the file sets `pass: 0.9`, an assertion the model gives 0.8 is unsure rather than a pass
  2. → When the file sets `fail: 0.1`, an assertion the model gives 0.2 is unsure rather than a fail
  3. → When the file leaves out `pass`, it is 0.75, and when it leaves out `fail`, it is 0.25
```

```dotrequirements
GUARD-2: A guardrails file that can't be checked is refused, and nothing is checked
  0. → When the file has no `assertions`, or an empty list, Sam is told there is nothing to check
  1. → When `pass` or `fail` is not a number, Sam is told which setting is wrong
  2. → When `pass` or `fail` is below 0 or above 1, Sam is told which setting is wrong
  3. → When `fail` is not below `pass`, after the defaults fill in any left out, Sam is told the two settings conflict
  4. → When the file is not valid YAML, Sam is told the line and column of the problem
  5. → When an assertion is not text, Sam is told which assertion, by its position in the list
  6. → When the file has a setting other than `assertions`, `pass` or `fail`, Sam is told which one, so a misspelled setting is never silently ignored
```

## Verdicts

```dotrequirements
GUARD-3: Each assertion gets a verdict from the model's probability that it holds
  0. → When the probability is at or above `pass`, the verdict is pass
  1. → When the probability is at or below `fail`, the verdict is fail
  2. → When the probability is between `fail` and `pass`, the verdict is unsure
  3. → Each verdict comes with the probability it was based on
```

```dotrequirements
GUARD-4: The model judges each assertion as Sam wrote it
  0. → Each assertion is put to the model worded exactly as written, less any whitespace around it, with no instructions or framing added to it
```

```dotrequirements
GUARD-5: Checking content against a guardrails file takes one model request, however many assertions the file holds
```

```dotrequirements
GUARD-6: Content too long for the model is cut to fit
  0. → When the content and the longest assertion together are well within what the model can judge in one request (32,000 tokens for Jev), all of the content is judged
  1. → When they are not, the beginning of the content is judged, the end is left out, and the result says the content was cut off
```

```dotrequirements
GUARD-7: Empty content is refused
  0. → When the content is empty, Sam is told there is nothing to judge, and nothing is checked
```

## Model access

```dotrequirements
GUARD-8: Sam reaches the model with either a Vercel AI Gateway key or a TypeSafe API key
  0. → When `AI_GATEWAY_API_KEY` is set, the model is reached through the AI Gateway with that key
  1. → When `TYPESAFE_API_KEY` is set, the model is reached through TypeSafe's own API with that key
  2. → When both are set, the AI Gateway key is used
  3. → When Sam passes a key to `check`, that key is used instead of any in the environment
  4. → When no key is given, Sam is told a key is needed, and nothing is checked
  5. → When the model cannot be reached or refuses the request, Sam is told why, and no verdicts are given
```

## In code

```dotrequirements
GUARD-9: Sam checks content from code with `check`, which returns a promise
  0. → `check` takes the guardrails in either form
    0.0. → as the path to a guardrails file
    0.1. → as an object with the same settings as the file
  1. → `check` takes the content in either form
    1.0. → as text
    1.1. → as any JSON value, which the model judges as its JSON text
  2. → The promise resolves to `{ results, truncated }`, where `results` lists `{ assertion, verdict, probability }` for each assertion in the order the guardrails list them, `verdict` is `"pass"`, `"fail"` or `"unsure"`, and `truncated` says whether the content was cut off
  3. → When `check` cannot give verdicts, because the guardrails or content are refused, no key is given or the model cannot be reached, the promise rejects with an error whose message says why
```

## On the command line

```dotrequirements
GUARD-10: Sam checks files from the command line with `semantic-guardrails check <guardrails> [files...]`
  0. → When Sam names files, they are judged together as one piece of content, in the order named, each marked with its path as Sam typed it
  1. → When Sam names no files, the content is read from standard input
  2. → When Sam names no files and standard input is a terminal, Sam is told to name files or pipe content in, and nothing is checked
  3. → Sam sees each failed and unsure assertion, in the guardrails file's order, with its probability to two decimal places, followed by how many assertions passed
  4. → When every assertion passes, Sam sees only how many passed
  5. → When Sam adds `--json`, the object `check` resolves to is printed to standard output, and nothing else is
  6. → When the content was cut off, Sam is told so on standard error
```

```dotrequirements
GUARD-11: The command's exit code tells a script what happened
  0. → When no assertion fails, the command exits 0, even when some are unsure
  1. → When any assertion fails, the command exits 1
  2. → Content being cut off does not change the exit code
  3. → When the command gives no verdicts, it exits 2
    3.0. → when the guardrails file is missing, unreadable or refused
    3.1. → when a named file cannot be read
    3.2. → when the content is empty
    3.3. → when no key is given
    3.4. → when the model cannot be reached or refuses the request
    3.5. → when the command is used wrongly, such as with no guardrails file named or an unknown option
```

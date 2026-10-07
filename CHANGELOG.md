# Changelog

## 0.1.0

First release.

- Assertions in a YAML file, with optional `pass` and `fail` thresholds (defaults 0.75 and 0.25), each checked by TypeSafe's Jev and given a verdict: pass, fail or unsure.
- `semantic-guardrails check <guardrails.yaml> [files...] [--json]`, exiting 0 when nothing fails, 1 when an assertion fails and 2 when it couldn't check.
- `check(guardrails, content, options?)` for use from code.
- Reaches Jev through the Vercel AI Gateway (`AI_GATEWAY_API_KEY`) or TypeSafe's own API (`TYPESAFE_API_KEY`).
- Content too long for the model is refused, never cut.

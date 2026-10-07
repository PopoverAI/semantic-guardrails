# CLAUDE.md

`semantic-guardrails` is a small open-source npm package: assertions in a YAML file, each checked by an evaluation model (TypeSafe's Jev) and given a pass, fail or unsure verdict. A library (`check`, `src/check.ts`) with a command on top (`src/cli.ts`). The README is written for a developer who wants semantically-enforced guardrails that are clean to configure and maintain; it describes what the package does, not what Jev does.

## Requirements and tests

Behavior is specified in `.requirements/semantic-guardrails.requirements.md` (dotrequirements format). Tests cite it with `requirement()` from `@popoverai/dotrequirements/test`. Change the requirements before the behavior, and when a criterion's position changes, update the tests that cite it in the same change. Tests stand in for the model by stubbing `fetch` (`src/testing/fake-model.ts`), so they need no key.

```sh
npm test         # builds, then runs vitest
npm run typecheck
npm run lint     # Biome; `npm run lint:fix` applies its fixes
```

Every pull request runs Biome (`.github/workflows/lint.yml`) and gets a formal review from `claude[bot]` (`.github/workflows/pr-review.yml`, which calls the shared workflow in PopoverAI/claude-pr-review).

## Releases

Publishing happens in CI, never from a laptop, and only from `main`: the publishing job uses the `npm` environment, which only `main` may use. Merging a PR that bumps `package.json`'s `version` to one not yet on npm makes `.github/workflows/publish.yml` run the `prepublishOnly` gate, publish through npm trusted publishing with provenance, and tag `v<version>` on that commit. To release, bump the version and add its entry to `CHANGELOG.md` in the PR that should ship. If a publish fails, fix the cause: merging the fix to main retries the publish on its own. To publish or tag a specific commit that is already on main, start the workflow by hand with its SHA. GitHub's Re-run replays the original commit and inputs, and only a commit on main can be published. A "Re-run failed jobs" asks npm again before publishing, so a re-run after an attempt that published but failed to tag skips the publish and tags the commit.

The workflow is ported from PopoverAI/convex-simple-authz's; keep the two close so a fix in either ports by diff.

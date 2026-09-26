# We Don't Need PRs

This repo is **the tool**: a Claude Code plugin (`tb`) for building software by reviewing
business rules instead of code. Products built with it (e.g. a todo app) live in their own
repos, set up with `/tb:init`, and hold their own `rules/` taxonomy. This repo has no product
rules.

## Layout

- `.claude-plugin/`: plugin manifest (`plugin.json`) and a local marketplace (`marketplace.json`).
- `skills/`: `init`, `branch`, `condense`, `commit`, `review`, `map`. Invoked as `/tb:<name>`.
- `docs/rules-format.md`: the rules taxonomy format. It's the contract every skill and the
  guardrails agree on. Change it and all of them together.
- `guardrails/dangerfile.js` and `.github/workflows/guardrails.yml`: the hard rules. Product
  repos call the workflow pinned to a commit SHA of this repo.

## Trust anchors

`guardrails/`, `.github/`, and `skills/review/` (the review page and server) are what a human
relies on to catch Claude's mistakes in product repos. When changing them:

- Only do it when the user asked for that change.
- Call out every change to these paths explicitly at the end of the turn, so the human knows
  to read the diff. Never bundle them silently with other work.
- Never weaken a check to make something pass.

## Developing

- Try the plugin locally: `claude --plugin-dir ~/Programming/we-dont-need-prs`, run from a
  product repo.
- Validate manifests and skills: `claude plugin validate .`
- Skills find their bundled files via the "base directory for this skill" that Claude Code
  provides when a skill loads. Never hardcode this repo's path in a skill.

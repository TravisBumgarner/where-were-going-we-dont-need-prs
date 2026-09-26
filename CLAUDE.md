# wit

This repo is **wit**: version control for business rules, replacing git and GitHub for
products built this way. You talk to Claude, and decisions are recorded as they happen. `wit condense`
turns them into a taxonomy of rules, and the human reviews rules, never code, on a local
GitHub-like server. Approving a review merges it, and that needs the owner's passkey.

## Layout

- `bin/wit.js`: the CLI entry. Node 24 runs the TypeScript in `src/` directly: no build, no deps.
- `src/cli.ts`: every command. `src/workdir.ts`: working copy snapshots and checkout.
  `src/client.ts`: API client. It never starts the server. `src/claude.ts`: launching Claude,
  interactively for `wit chat` and headless for `wit condense` / `wit apply`.
- `src/prompts/`: what Claude is told in chat, condense, and apply. These are the product's
  behavior as much as the code is.
- `src/rules.ts`: the rules taxonomy parser, shared by CLI and server. `docs/rules-format.md` is
  the format contract. Change them together.
- `src/server/`: the server, run from this repo with `npm start`. SQLite at `data/wit.db` (`db.ts`, gitignored), rule-level three-way merge for
  `wit sync` (`merge.ts`), passkey approval (`webauthn.ts`), routes (`index.ts`).
- `src/checks.ts`: the guardrails. Nothing merges while one fails.
- `src/web/`: the pages. `app.html` (repos, repo, passkey setup), `review.html`, `map.html`.
  Plain HTML and JS, no framework.

## Trust anchors

The human relies on these to catch Claude's mistakes:
- `src/checks.ts`
- `src/server/webauthn.ts`
- the approve route in `src/server/index.ts`
- `src/web/review.html`

When changing any of them:
- Only do it when asked.
- Call out every change to these files at the end of the turn, so the human knows to read the diff.
- Never weaken a check to make something pass.

## Developing

- Typecheck: install TypeScript somewhere outside the repo and run `tsc` with `"allowImportingTsExtensions"`
  and `"erasableSyntaxOnly"`. Only erasable TypeScript is allowed (no enums, no parameter properties),
  because Node strips types rather than compiling.
- Test against an isolated server so you don't touch real data:
  `WIT_DATA=/tmp/wit-test WIT_PORT=4799 npm start`, then `WIT_PORT=4799 wit …`.
- Passkeys need the `localhost` hostname, not `127.0.0.1`.

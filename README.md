# wit

Version control for business rules. You don't review code: you review the rules the code is built from.

```
wit init                    make this folder a wit repo
wit start "add reminders"   start a branch
wit chat                    talk to Claude; every decision is recorded as it's made
wit condense                turn the decisions into rules (like commit)
wit review                  review the rules in the browser; approving merges
wit apply                   have Claude apply the changes you requested
wit sync                    bring main's latest rules into your branch
```

Also: `wit status`, `wit log`, `wit map` (the rules as a zoomable map, or `--hierarchy` for a table), `wit switch`,
`wit discard`, `wit abandon`, `wit open`. Files listed in `.witignore` (same syntax as `.gitignore`) are never tracked; `node_modules/`, `dist/`, `.env`, and database files are ignored by default.

## Install

Needs Node 24+ and [Claude Code](https://claude.com/claude-code).

```sh
cd ~/Programming/we-dont-need-prs
npm link
```

Then start the server. It runs from this repo, not from the repos it tracks:

```sh
npm start
```

It serves http://localhost:4711 and keeps every repo's history in `data/wit.db`, which is
gitignored. `wit` commands in your product repos connect to it, and tell you if it isn't running.

Before your first review, open http://localhost:4711/setup and create your passkey. Only that
passkey can approve and merge.

## How it fits together

- **Rules** live in `rules/` as a tree. Every folder is a node, and its `index.md` holds that
  node's rules. See [docs/rules-format.md](docs/rules-format.md).
- **Your folder is a working copy.** The server owns the history. `wit condense` saves a
  revision: the rules, plus a snapshot of the code.
- **Reviews** show every rule and node the branch adds, changes, moves, or retires, in its
  place in the tree. You approve each one, ask for changes, reject it, or re-file it elsewhere.
- **Merging** runs the guardrail checks and requires your passkey's signature over the exact
  revision you reviewed. Every merge into main is signed, and the history page verifies them.

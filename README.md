# wit

Version control for business rules. You don't review code: you review the rules the code is built from.

You talk to Claude, and every decision is recorded as it's made. `wit condense` turns those decisions
into a tree of rules, and you review the rules in your browser. Approving a review merges it, and
that takes your passkey.

```
wit init                     make this folder a wit repo
wit start "<description>"    start a branch off main (brings uncondensed changes along)
wit chat                     talk to Claude; decisions are recorded as they're made
wit condense                 turn decisions into rules and save a revision (like commit)
wit review                   review the rules in the browser; approving merges
wit apply                    have Claude apply requested changes
wit sync                     bring main's latest into this branch

wit status                   branch, recorded decisions, uncondensed changes
wit log                      revisions on this branch and main
wit map [--hierarchy]        the rules as a zoomable map, or a table
wit note "<decision>"        record a decision (Claude does this during chat)
wit switch <branch|main>     switch branches
wit discard [<path>…]        throw away uncondensed changes
wit abandon                  close this branch without merging
wit open                     open this repo on the server
```

## Install

Needs Node 24+ and [Claude Code](https://claude.com/claude-code).

```sh
cd ~/Programming/we-dont-need-prs
npm link      # puts `wit` on your PATH
npm start     # runs the server; leave it running
```

The server runs from this repo, not from the repos it tracks. It serves http://localhost:4711
and keeps every repo's history in `data/wit.db` (gitignored). `wit` commands in your product
repos connect to it, and tell you if it isn't running.

Before your first review, open http://localhost:4711/setup and create your passkey. Only that
passkey can approve and merge. Do this yourself: whoever registers first becomes the owner.

## A sample "PR"

Building reminders for a todo app, from start to merged.

**1. Start a branch.** Branches always come off `main`.

```console
$ wit start "add reminders to items"
✓ On new branch add-reminders-items from main r7.

Next: wit chat
```

**2. Talk it through with Claude.** Claude reads the existing rules first, builds what you ask
for, and records each decision as it's made by running `wit note`.

```console
$ wit chat
> Items should be able to have a reminder. Only if the user turns it on though,
> people hate notification spam. One reminder per item is plenty.
  ⏺ wit note "Reminders are opt-in per item, because people hate notification spam"
  ⏺ wit note "An item has at most one reminder"
  …
3 decisions recorded on add-reminders-items. Next: wit condense
```

Check what's been recorded at any point:

```console
$ wit status
todo · branch add-reminders-items · r7
add reminders to items

Decisions recorded (3)
  - 2026-09-26 14:02 — Reminders are opt-in per item, because people hate notification spam
  - 2026-09-26 14:03 — An item has at most one reminder
  - 2026-09-26 14:05 — Reminders fire at 9am local time on the due date

Uncondensed changes (4)
  added     packages/api/src/routes/reminders/index.ts
  modified  packages/shared/src/db/schema.ts
  …
```

**3. Condense, the equivalent of committing.** Claude turns the decision log (and the chat
transcript) into rules, puts each one in the right place in the tree, and saves a revision with
the rules plus a snapshot of the code.

```console
$ wit condense
Condensing add-reminders-items…
  • NODE items/reminders: Reminders
  • NEW ITEMS-005 (items/reminders): Reminders are opt-in per item
  • NEW ITEMS-006 (items/reminders): An item has at most one reminder
  • NEW ITEMS-007 (items/reminders): Reminders fire at 9am local time

✓ r8 on add-reminders-items: Add opt-in reminders on items
Next: wit review
```

If a decision contradicts an existing rule, Claude doesn't write it. It reports the conflict
and leaves it in the log for your next `wit chat`.

**4. Review the rules.** This opens the review page in your browser: every rule and node the
branch adds, changes, moves or retires, shown in its place in the tree, plus the guardrail
check results.

```console
$ wit review
Review: http://localhost:4711/r/todo/reviews/12
```

For each rule you choose one of:
- **Approve.**
- **Needs changes**, with a comment.
- **Reject**, with a comment.
- **File under…** a different node, or a new one.

Then either:

- **Request changes.** Your feedback is saved, and you continue in the terminal (step 5).
- **Approve & merge.** Enabled once everything is approved and the checks pass. Confirm with
  Touch ID, and the branch merges into `main`, signed by your passkey. You're done.

**5. Apply the feedback.** Either let Claude apply it directly:

```console
$ wit apply
Applying review #12…
  • REVISED ITEMS-007 (items/reminders): time is configurable per user, defaulting to 9am
  • MOVED ITEMS-006 (items/reminders → items)

✓ r9 on add-reminders-items. Next: wit review
```

…or discuss it first with `wit chat` (Claude sees the feedback), then `wit condense`.

**6. Review again.** `wit review` opens a new review for the latest revision. Repeat steps 4–5
until you approve and merge.

**If `main` moved in the meantime**, the review says so and merging is blocked. Run `wit sync`
to bring main's changes in. Rules merge rule by rule, so two branches that touch different
rules in the same node merge cleanly. Then `wit review` again.

## How it fits together

- **Rules** live in `rules/` as a tree. Every folder is a node, and its `index.md` holds that
  node's rules. Rules apply to everything below their node. See
  [docs/rules-format.md](docs/rules-format.md).
- **Your folder is a working copy.** The server owns the history. `.wit/` in your repo only
  records which repo, branch and revision you're on, plus the decision log.
- **`.witignore`** lists files wit never tracks. It uses the same syntax as `.gitignore`, and a
  `.witignore` in any folder applies to that folder. `node_modules/`, `dist/`, `build/`,
  `coverage/`, `.env*` (except `.env.example`), database files, `*.log` and `.DS_Store` are
  ignored by default. Un-ignore a default with `!`, e.g. `!build/`.
- **Merging** runs the guardrail checks and needs your passkey's signature over the exact revision
  you reviewed. The checks cover:
  - no rule deleted (retire it instead)
  - no retired rule revived
  - every change has a History line
  - unique, well-formed IDs
  - a well-formed tree
  - no secrets

  Every merge into main is signed, and the repo page verifies the signatures.

---
name: review
description: Open the rules review — a PR-like page showing every rule and taxonomy node the current branch adds, changes, moves, or retires, in its place in the tree — then apply the reviewer's decisions. Use when the user says "/tb:review", "review the rules", or wants to review a branch before it lands.
---

# /tb:review

This is the pull request: review happens in the browser, organized by the rules taxonomy. Each changed node is a section, like a file in a PR. The reviewer can:

- approve each rule and node, ask for changes, or reject it
- **re-file** a rule under a different node, including a brand-new one
- open any node on the zoomable map for context

## 1. Preconditions

- Must be on a work branch, not `main`. If on `main`, stop and say so.
- If `rules/` has uncommitted changes, tell the user and offer to run `/tb:commit` first. The page only shows committed rules.

## 2. Start the review

Run the server **in the background** (`run_in_background: true`) so you're re-invoked when the reviewer submits. Use this skill's base directory:

```sh
node <skill base directory>/server.mjs --open
```

It prints `REVIEW_URL <url>` and opens the browser. Tell the user the URL in one line. Then wait. Don't poll, and don't do other work on this branch while the review is open.

When the reviewer submits, the server prints `DECISIONS_WRITTEN <path>` and exits. The file looks like this:

```json
{ "branch": "…", "base": "<sha>", "head": "<sha>", "summary": "overall comment",
  "nodes": [{ "path": "items/reminders", "kind": "new|changed|removed", "decision": "approve|revise|reject", "comment": "…" }],
  "rules": [{ "id": "ITEMS-005", "kind": "new|changed|moved|retired|removed", "decision": "approve|revise|reject", "comment": "…",
              "moveTo": null | "items/overdue", "newNode": null | { "path": "items/overdue", "title": "Overdue" } }] }
```

## 3. Apply the decisions

Read the decisions file. If `head` no longer matches `git rev-parse HEAD`, the branch moved during review. Tell the user and ask whether to apply anyway or re-run `/tb:review`.

Apply **node** decisions first, since rule re-filing may depend on them:

- **approve**: leave it alone.
- **revise**: edit the node's title or summary as the comment asks.
- **reject**, by kind:
  - `new`: the node shouldn't exist. Ask where its rules should go if the comment doesn't say. Move them there (with History lines), then delete the folder.
  - `changed`: restore the title and summary from `main`.
  - `removed`: restore the node from `main`.

Then **rule** decisions:

- **re-file (`moveTo` set)**, when approved or revised: move the rule to that node. If `newNode` is set, first create the folder with an `index.md`: the given title, plus a one-sentence summary. Write the summary from the rules that will live there, and flag it for the next review. Add a History line: `- <date> (<branch>): Moved to <path> in review.`
- **approve**: leave it alone, apart from any re-file.
- **revise**: rewrite the rule to address the comment, then apply any re-file. Follow the comment literally. If it's ambiguous, ask rather than guess. Add a History line: `- <date> (<branch>): Revised in review — <summary>`.
- **reject**, by kind (ignore `moveTo`):
  - `new`: remove the rule entirely. It never landed, so there's nothing to retire and its ID is free.
  - `changed`, `retired` or `moved`: restore the rule's text and location from `main`.
  - `removed`: restore it from `main`.

  In every case, tell the user whether the code on this branch still depends on the rejected rule. If it does, list the files.

After applying, check the taxonomy rules in the tb plugin's `docs/rules-format.md`, which is `../../docs/rules-format.md` relative to this skill's base directory:
- no node left empty by moves, unless the reviewer wanted it
- no child rule contradicting a rule it now sits under

Raise anything you find with the user.

Also act on the overall `summary` comment if it asks for something.

If anything changed, commit it as `Apply review feedback` using the same `Rules:` body format as `/tb:commit`. Include `NODE` lines for any nodes created, edited or removed. Then offer to run `/tb:review` again so the changes get approved too.

## 4. When everything is approved

Say that the branch is approved. Offer to push it and open a PR so the guardrails check can run, with the list of rule IDs in the PR description. Don't push or merge without a yes, and never merge to `main` yourself.

## Notes

- The decisions file lives in `.review/`, which is gitignored. It's a hand-off, not a record. The record is the rules' `History` lines.
- Never edit `server.mjs` or `review.html` during a review to make something pass or display differently.

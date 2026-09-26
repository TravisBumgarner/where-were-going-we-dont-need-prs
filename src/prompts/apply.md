# Apply review feedback to the rules

You're running inside `wit apply`, non-interactively. The human reviewed the rules on branch
`{{BRANCH}}` ({{DESCRIPTION}}) and asked for changes. Apply their decisions to `rules/`.
Today is {{DATE}}.

Read the rules format first: `{{RULES_FORMAT}}`.

## The decisions

```json
{{DECISIONS}}
```

`nodes` and `rules` list one decision per item: `approve`, `revise`, or `reject`, with a
comment. A rule may also have `moveTo` (a node path) and `newNode` (`{path, title}`) when the
reviewer re-filed it.

## Apply node decisions first

- **approve**: leave it.
- **revise**: edit the node's title or summary as the comment asks.
- **reject**, by kind:
  - `new`: the node shouldn't exist. Move its rules where the comment says, or to its
    parent if it doesn't say. Add History lines, then delete the folder.
  - `changed`: restore the title and summary as they were before this branch.
  - `removed`: restore the node.

To see how things were before this branch, read the base revision's files at `{{BASE_DIR}}`.

## Then rule decisions

- **re-filed** (`moveTo` set, when approved or revised): move the rule to that node. If
  `newNode` is set, first create the folder and its `index.md` with that title and a
  one-sentence summary. Add History: `- {{DATE}} ({{BRANCH}}): Moved to <path> in review.`
- **approve**: leave it, apart from any re-file.
- **revise**: rewrite the rule to do exactly what the comment asks. Add History:
  `- {{DATE}} ({{BRANCH}}): Revised in review — <summary>`.
- **reject** (ignore `moveTo`), by kind:
  - `new`: delete the rule entirely.
  - `changed`, `moved` or `retired`: restore its text and location from the base revision.
  - `removed`: restore it from the base revision.

Also act on the overall `summary` comment if it asks for something.

Only edit files under `rules/`. If a comment is too ambiguous to apply confidently, don't guess.
Leave that item unchanged and report it.

## Report

End your final message with exactly one fenced JSON block:

```json
{
  "message": "Apply review feedback: <one-line summary>",
  "changes": ["REVISED LISTS-001 (lists): ...", "REJECTED ITEMS-005", "MOVED ITEMS-003 (items → items/overdue)", "NODE items/overdue: Overdue"],
  "unresolved": ["Items you couldn't apply, and why"],
  "codeImpact": ["Rejected or changed rules that code on this branch still depends on, with file paths"]
}
```

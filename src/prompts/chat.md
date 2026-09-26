# You are working in a wit repo

This repo is built with **wit**: business rules are the source of truth, not code. The rules
live as a taxonomy in `rules/`. Code is a build artifact that can be regenerated from them.
What gets reviewed is the rules, never the code.

- Repo: `{{REPO}}`
- Branch: `{{BRANCH}}`: {{DESCRIPTION}}
- Rules format: `{{RULES_FORMAT}}`. Read it before touching anything in `rules/`.

## Record every decision as it happens

The human will run `wit condense` later to turn this conversation into rules. Your
decision log is what it works from. Whenever a **decision about behavior** is made, record
it immediately, in the same turn, by running:

```sh
wit note "<the decision, as one plain sentence>"
```

- Record what the user decides, and above all their corrections to you.
- Record constraints you discover (an API limit, a legal requirement).
- Include the reason if one was given: `wit note "Trials last 14 days, because longer trials didn't convert"`.
- If a decision replaces an earlier one, record the new one and say it replaces the old.
- Don't record implementation details (library choice, file layout, names) unless the user
  says they matter.
- Decisions you make yourself while building (a limit, an edge case) count too. Record them,
  and mention them to the user so they can object.

Run `wit status` to see what's recorded so far.

## Working rules

- Read the relevant nodes in `rules/` before implementing anything, including every ancestor
  of those nodes. Rules apply to everything below their node.
- If what's being asked would violate an existing rule, stop and say so. Don't work around it.
  If the user wants to change the rule, record that as a decision.
- Don't edit `rules/` yourself. `wit condense` writes the rules from your log.
- Write code freely. It's snapshotted when the human condenses, but only the rules are reviewed.
- Don't run any `wit` command except `wit note` and `wit status`. Branching, condensing,
  reviewing and merging belong to the human. Approving and merging need their passkey anyway.
{{FEEDBACK}}

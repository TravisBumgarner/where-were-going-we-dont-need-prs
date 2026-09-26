# {{PRODUCT_NAME}}

This repo is built with the **tb** plugin: business rules are the source of truth, not code.
What gets reviewed is the taxonomy of rules in `rules/`. Code is a build artifact that can
be regenerated from the rules.

## How work happens

1. `/tb:branch "<what we're doing>"` starts a work branch off `main`.
2. Work happens in a conversation: exploring, deciding, building.
3. `/tb:commit` condenses the conversation into rules, places them in the taxonomy, and
   commits them (plus any code) to the branch. It never commits to `main`.
4. `/tb:review` opens the rules review: every rule and node the branch adds, changes, moves,
   or retires, shown in its place in the tree. A human approves, re-files, requests changes,
   or rejects each one, and Claude applies the decisions.
5. Once everything is approved, the branch goes up as a PR, the guardrails run, and a human
   merges it.

`/tb:condense` previews what a conversation would produce, without committing.
`/tb:map` opens the whole taxonomy as a zoomable map.

## Rules

- Rules form a tree in `rules/`. Every folder is a node, and its rules live in that folder's
  `index.md`. The format is defined in the tb plugin's `docs/rules-format.md`.
- Rules apply to everything below their node. Children narrow their ancestors' rules and never
  contradict them. Put each rule at the highest node where it's true.
- Each rule has a stable ID (`<TOP-LEVEL-NODE>-<NNN>`). IDs don't change when a rule moves,
  and are never reused.
- A rule states *what* must be true, not *how* to implement it, and must be verifiable.
- When rules conflict, the conflict is surfaced to the human, never silently resolved.
- Changing a rule means editing it in place and adding a dated `History` line. Removing a rule
  means marking it `Status: retired`, never deleting it.

## When writing code

- Read the relevant nodes in `rules/` before implementing anything, including every ancestor
  of those nodes.
- If code would violate a rule, stop and say so rather than working around it.
- If a decision is made that no rule covers, flag it. It's a candidate for `/tb:commit`.

## Guardrails

Hard rules run in CI on every PR, from the tb tool repo pinned to a commit
(`.github/workflows/guardrails.yml`). They're enforced outside Claude on purpose. Claude
must not edit `.github/`, `.claude/`, or `CODEOWNERS`. Changes there are made by a human.

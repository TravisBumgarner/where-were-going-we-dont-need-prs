---
name: condense
description: Condense the current conversation into business rules, placed in the rules taxonomy, for human review in the terminal. Writes approved rules to rules/ but doesn't commit. Use when the user says "/tb:condense", "condense this", "what rules came out of this", or wants to preview rules before /tb:commit.
---

# /tb:condense

Turn the whole conversation into a reviewable set of business rules, each placed at the right node of the taxonomy in `rules/`. Read the rules format first, `../../docs/rules-format.md` relative to this skill's base directory. It defines the tree layout and rule format.

## 1. Extract

Read the entire conversation, start to finish. Pull out every **decision about behavior**:

- Explicit statements from the user ("users can only have one active subscription").
- Corrections the user made to you. These are usually the most important rules.
- Decisions implied by code that was written and accepted (a validation, a limit, an edge-case branch).
- Constraints discovered along the way (an external API's limit, a legal requirement).

Skip:

- Implementation details that don't change behavior (library choice, file layout, variable names), unless the user explicitly said they matter.
- Ideas that were proposed and then rejected or abandoned. Mention notable ones under "Considered and rejected" so reviewers see them.
- Anything only relevant to this conversation.

If the conversation changed its mind, keep only the final position.

## 2. Place each rule in the taxonomy

Walk the tree (`find rules -name index.md`) and read the nodes along the relevant branches, including every ancestor of where a rule might land.

For each rule:

- **Find the highest node where it's true.** If it holds for all of billing, it belongs on `billing/`, not `billing/invoices/`.
- **Check the ancestors.** A rule must not contradict anything above it. A contradiction is a **Conflict**.
- **New nodes.** If no node fits, propose one: a folder name, a title, and a one- or two-sentence summary. Only create a node when it will plausibly hold several rules or children. Otherwise put the rule on the nearest existing parent.
- **Restructuring.** If this rule pushes a node past about 7 rules, or reveals that a rule shared by every child belongs on the parent, propose the move. Moves are reviewed like any other change.

## 3. Reconcile with existing rules

Classify every extracted rule:

- **New**: nothing existing covers it. Assign the next unused ID for its top-level node. Search the whole subtree and the git history (`git log -p -- rules/`) for the highest ID ever used, including retired ones.
- **Changed**: modifies an existing rule. Keep its ID.
- **Moved**: same rule, different node. Keep its ID.
- **Retired**: the conversation made an existing rule obsolete.
- **Duplicate**: already captured as-is. Drop it silently.
- **Conflict**: contradicts an existing rule or an ancestor's rule, and the conversation didn't clearly intend to change it. Never resolve these yourself.

## 4. Write each rule well

- One behavior per rule. Split compound rules.
- State *what* must be true, not *how* to build it.
- Use "must" / "must not" / "may". Avoid "should" unless it's genuinely a soft preference.
- Make it verifiable: a reader could look at an implementation and say whether it complies.
- Include at least one ✅ and one ❌ example drawn from the conversation where possible.
- Put the reason in **Why**. If the conversation never said why, write `Why: (not stated — please fill in)` rather than inventing one.

## 5. Present for review

Show the proposal in the terminal, grouped in this order:

```
## Conflicts (need a decision)
## New nodes
## Changed / Moved
## New rules
## Retired
## Considered and rejected (not written — FYI)
```

Show each rule with its tree path (`billing › invoices › BILLING-004`). For Changed, show a before/after of just the parts that changed. For Conflicts, quote both sides, including which ancestor it conflicts with.

Number every item so the user can reply with things like "approve all but 4, reword 2 to …, put 6 under trials instead".

Then stop and wait. Don't write anything to `rules/` yet.

## 6. Apply

After the user responds:

- Create new nodes (folder plus `index.md` with title and summary).
- Write approved rules into the right node's `index.md`.
- For changed or moved rules, edit in place (or cut and paste to the new node) and append a History line with today's date and a one-line summary.
- For retired rules, set `Status: retired` and add a History line. Never delete.
- Apply any rewording or re-placement the user asked for exactly.
- Don't commit. Summarize what was written (nodes and rule IDs) and let the user commit, or suggest `/tb:commit`.

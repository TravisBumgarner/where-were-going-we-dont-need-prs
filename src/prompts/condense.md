# Condense decisions into business rules

You're running inside `wit condense`, non-interactively. Turn the decisions made on branch
`{{BRANCH}}` ({{DESCRIPTION}}) into business rules in the `rules/` taxonomy. Today is {{DATE}}.

Read the rules format first: `{{RULES_FORMAT}}`.

## Inputs

- **Decision log**, the primary source. Recorded live during the conversation:
  `{{LOG}}`
- **Conversation transcripts**, a secondary source. Use them to understand the log entries
  and to catch decisions that were never logged:
{{TRANSCRIPTS}}
- **Every rule ID ever used in this repo**, including retired ones. Never reuse any of them:
  {{IDS}}

## 1. Extract

Pull out every decision about behavior:
- the user's explicit statements
- their corrections
- behavior implied by code that was written and accepted
- constraints that were discovered

Skip implementation details (unless the user said they matter), ideas that were rejected or
abandoned, and anything only relevant to the conversation itself. If a decision was changed
later, keep only the final position.

## 2. Place each rule in the taxonomy

Read the nodes along every relevant branch of `rules/`, including all ancestors.

- Put each rule on the **highest node where it's true**.
- A rule must not contradict any ancestor's rules. If it does, that's a conflict.
- If no node fits, create one: a folder, plus an `index.md` with a `# Title` and a one- or
  two-sentence summary. Only create a node when it will plausibly hold several rules or children.
- If a node would pass about 7 rules, or every child shares a rule that belongs on the parent,
  restructure: move rules with History lines.

## 3. Reconcile with existing rules

For each extracted rule, decide which case it is:
- **new**: next unused ID for its top-level node. Check the ID list above.
- **changed**: edit in place.
- **moved**: keep the ID.
- **retired**: set `Status: retired`, never delete.
- **duplicate**: skip.
- **conflict**: contradicts an existing rule or ancestor, and the decisions didn't clearly
  intend to change it.

**Never write a conflict.** Report it instead.

## 4. Write

- One behavior per rule. State *what* must be true, not *how*. Use "must" / "must not" / "may".
- Make it verifiable.
- Give ✅ and ❌ examples from the conversation where possible.
- Put the reason in **Why**. If none was given, write `(not stated — please fill in)`. Never invent one.
- Every new, changed, moved or retired rule gets a History line: `- {{DATE}} ({{BRANCH}}): <what happened>`.
- Only edit files under `rules/`. Never touch code.

## 5. Report

End your final message with exactly one fenced JSON block:

```json
{
  "message": "one-line summary of the behavior change, like a commit message",
  "changes": ["NEW ITEMS-005 (items/reminders): Reminders are opt-in", "NODE items/reminders: Reminders", "CHANGED LISTS-001 (lists): ...", "MOVED ITEMS-003 (items/due-dates → items): ...", "RETIRED ITEMS-004 (items/completion): ..."],
  "conflicts": ["What was decided, which rule it conflicts with, and why"],
  "skipped": ["Decisions deliberately not turned into rules, and why"]
}
```

If nothing in the inputs is rule-worthy, change nothing and return an empty `changes` list.

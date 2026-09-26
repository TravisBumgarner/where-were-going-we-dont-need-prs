---
name: commit
description: Condense the current conversation into business rules, write them to rules/, and commit them (with any code) to the current work branch. Refuses to run on main. Use when the user says "/tb:commit", "commit this", or wants to save the session's decisions.
---

# /tb:commit

Capture this conversation as business rules and commit them. Review happens later, in `/tb:review`, so this step writes and commits without asking for approval, **except for conflicts**.

## 1. Check the branch

Run `git branch --show-current`.

- If it prints `main` (or `master`), or nothing (detached HEAD), stop. Tell the user to start a branch with `/tb:branch` first. Never commit to main.
- If this isn't a git repo, stop and say so.

## 2. Condense

Follow steps 1–4 of the condense skill (`../condense/SKILL.md` relative to this skill's base directory) (Extract, Place in the taxonomy, Reconcile, Write each rule well). Differences:

- Only extract what's new since the last `/tb:commit` on this branch. Check `git log main..HEAD` and the rules already changed on the branch (`git diff main...HEAD -- rules/`) so you don't capture the same decision twice.
- **Conflicts:** if any extracted rule contradicts an existing rule and the conversation didn't clearly mean to change it, stop. Show both sides and ask the user to decide. Write nothing until they answer.
- If there's nothing rule-worthy in the conversation, say so and stop. Don't make an empty commit, and don't invent rules to have something to commit.

## 3. Write

Apply the rules as in step 6 of the condense skill: create any new nodes, put new rules in the right node's `index.md`, edit changed or moved rules with a dated `History` line, and mark retired rules `Status: retired`. For every History line, use today's date and name this branch, e.g. `- 2026-09-25 (free-trial-limits): Created.`

## 4. Commit

1. Run `git status` and look at everything that changed.
2. Never stage anything under `.github/`, `.claude/` or `CODEOWNERS`. If any of those changed, stop and tell the user. Those paths are human-only.
3. Stage the rule files plus any code changes from this conversation. Don't stage unrelated files you didn't touch. If you aren't sure whether a file belongs, ask.
4. Commit using this message format:

   ```
   <one-line summary of the behavior change>

   Rules:
   - NODE billing/trials: Free trials
   - NEW BILLING-004 (billing/trials): Trial lasts 14 days
   - MOVED BILLING-001 (billing → billing/invoices): Invoices are immutable once sent
   - CHANGED BILLING-002: Invoices are immutable once sent
   - RETIRED AUTH-007: Password must rotate every 90 days
   ```

   If the commit contains code but no rule changes, say so explicitly in the body (`Rules: none — <why>`).

5. Don't push.

## 5. Report

List the nodes and rule IDs written (new, changed, moved or retired) and the commit hash, and say that `/tb:review` will open them for review.

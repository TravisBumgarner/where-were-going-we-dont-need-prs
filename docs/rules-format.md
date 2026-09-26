# Rules format

Business rules form a taxonomy: a tree of **nodes**, where each node holds the rules
that are true at that level of generality. Zoomed out, you see principles. Zoomed in,
you see specifics.

Run `wit map` to explore it as a zoomable map.

## Layout

Every folder under `rules/` is a node. Its rules live in that folder's `index.md`.

```
rules/
  index.md                 ← root: product-wide principles
  billing/
    index.md               ← rules for all of billing
    invoices/
      index.md             ← rules specific to invoices
    trials/
      index.md
  auth/
    index.md
```

- A folder name is a lowercase kebab-case noun (`invoices`, `free-trials`).
- Every folder must have an `index.md`.
- Keep depth shallow. Three levels below the root is usually plenty.

## How the hierarchy works

- **Rules apply downward.** A rule on `billing/` applies to everything under `billing/`.
- **Children narrow, never contradict.** A child rule may be more specific than its
  ancestors ("trials last 14 days" under "all paid plans are billed monthly"), but must
  not conflict with them. If it does, that's a conflict for a human to resolve.
- **Put a rule at the highest node where it's true.** If the same rule shows up in
  every child, lift it into the parent.
- **Split crowded nodes.** Once a node has more than about 7 rules, look for a natural
  child grouping.

## Node file format

```markdown
# Invoices

What an invoice is and how it behaves once it exists. One or two sentences:
this is the text shown when zoomed out.

## BILLING-001: Invoices are immutable once sent

**Status:** active
**Rule:** After an invoice is sent to a customer, its line items and totals must not change. Corrections are issued as a new credit note.
**Why:** Customers and accountants need a stable record of what was billed.
**Examples:**
- ✅ Customer disputes a charge → credit note issued, original invoice untouched.
- ❌ Admin edits the amount on a sent invoice.
**History:**
- 2026-09-25 (branch-name): Created.
```

- The `# Title` and summary paragraph are required. Rules are optional; a node can just
  group its children.
- **Rule IDs** use the prefix of the top-level node (`billing/…` → `BILLING-`) and are
  numbered in order of creation across that whole subtree.
- **IDs are stable.** A rule keeps its ID if it moves elsewhere in the tree, even to a
  different top-level node. Never renumber, and never reuse an ID.
- Moving a rule is a change: add a History line like `Moved from billing/ to billing/invoices/.`

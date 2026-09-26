---
name: map
description: Open a zoomable, Prezi-style map of the business rules taxonomy in the browser. Use when the user says "/tb:map", "show me the rules", "open the map", or wants to explore or present how the rules are organized.
argument-hint: "[node path or rule ID to zoom to]"
---

# /tb:map

Build and open a zoomable map of `rules/`. Every node is a box holding its rules and its child nodes, drawn smaller inside it. Click to zoom in, Esc to zoom out, ← → to tour through the whole tree in order.

1. Run this from the product repo (the one with `rules/`), using this skill's base directory:
   ```sh
   node <skill base directory>/build.mjs
   ```
   It reads the working tree, so uncommitted rules show up too. It writes one self-contained HTML file to the temp directory, opens it, and prints `MAP <path>`.
2. If the user named a node or rule, open straight to it by appending a hash:
   `open "<path>#node=items/due-dates"` or `open "<path>#rule=ITEMS-003"`.
3. Tell the user in one line what's on the map (total rules, top-level areas).

If there's no `rules/` folder, suggest `/tb:init`.

The map is read-only. To change rules or how they're organized, use `/tb:condense` or `/tb:commit`, then `/tb:review`.

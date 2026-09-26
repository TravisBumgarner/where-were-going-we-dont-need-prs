// Three-way merge of trees, used by `wit sync` to bring main's changes into a branch.
// Rules merge rule by rule, so two branches editing different rules in the same node don't conflict.

import { createHash } from "node:crypto";
import { isNodeFile } from "../rules.ts";
import { getBlob, type Tree } from "./db.ts";

const text = (hash: string | undefined) => (hash ? Buffer.from(getBlob(hash) ?? []).toString("utf8") : undefined);
export const hashOf = (data: Buffer) => createHash("sha256").update(data).digest("hex");

// Picks a side when at most one side changed. Returns `conflict` when both changed differently.
const pick = <T>(base: T, ours: T, theirs: T): { value: T } | "conflict" => {
  if (ours === theirs) return { value: ours };
  if (ours === base) return { value: theirs };
  if (theirs === base) return { value: ours };
  return "conflict";
};

const splitNode = (source: string | undefined) => {
  if (source === undefined) return undefined;
  const first = source.search(/^## /m);
  const header = (first === -1 ? source : source.slice(0, first)).trim();
  const rules = new Map<string, string>();
  const headings = [...source.matchAll(/^## (\S+): .+$/gm)];
  headings.forEach((m, i) => rules.set(m[1], source.slice(m.index, headings[i + 1]?.index ?? source.length).trim()));
  return { header, rules };
};

const mergeNodeFile = (path: string, b?: string, o?: string, t?: string) => {
  const conflicts: string[] = [];
  const [base, ours, theirs] = [splitNode(b), splitNode(o), splitNode(t)];
  const header = pick(base?.header, ours?.header, theirs?.header);
  if (header === "conflict") conflicts.push(`${path}: the node's title/summary changed on both main and this branch`);
  const ids = [...new Set([...(theirs?.rules.keys() ?? []), ...(ours?.rules.keys() ?? []), ...(base?.rules.keys() ?? [])])];
  const bodies: string[] = [];
  for (const id of ids) {
    const merged = pick(base?.rules.get(id), ours?.rules.get(id), theirs?.rules.get(id));
    if (merged === "conflict") {
      conflicts.push(`${path}: rule ${id} changed on both main and this branch`);
      const fallback = theirs?.rules.get(id) ?? ours?.rules.get(id);
      if (fallback) bodies.push(fallback);
    } else if (merged.value !== undefined) bodies.push(merged.value);
  }
  const head = header === "conflict" ? theirs?.header ?? ours?.header ?? "" : header.value ?? "";
  if (!head && bodies.length === 0) return { content: undefined, conflicts };
  return { content: `${[head, ...bodies].filter(Boolean).join("\n\n")}\n`, conflicts };
};

export const mergeTrees = (base: Tree, ours: Tree, theirs: Tree) => {
  const tree: Tree = {};
  const newBlobs = new Map<string, Buffer>();
  const conflicts: string[] = [];
  const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const path of paths) {
    const choice = pick(base[path], ours[path], theirs[path]);
    if (choice !== "conflict") {
      if (choice.value) tree[path] = choice.value;
      continue;
    }
    if (isNodeFile(path)) {
      const merged = mergeNodeFile(path, text(base[path]), text(ours[path]), text(theirs[path]));
      conflicts.push(...merged.conflicts);
      if (merged.content !== undefined) {
        const data = Buffer.from(merged.content);
        const hash = hashOf(data);
        newBlobs.set(hash, data);
        tree[path] = hash;
      }
    } else {
      conflicts.push(`${path}: changed on both main and this branch`);
      const keep = theirs[path] ?? ours[path];
      if (keep) tree[path] = keep;
    }
  }
  return { tree, newBlobs, conflicts };
};

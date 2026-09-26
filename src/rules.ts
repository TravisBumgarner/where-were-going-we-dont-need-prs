// Parsing the rules taxonomy. Shared by the CLI and the server.
// A snapshot of files is a Files map: path → content. Rules live under rules/, one node per
// folder, with the node's title, summary, and rules in that folder's index.md.

export type Files = Record<string, string>;

export type Rule = {
  id: string;
  title: string;
  node: string;
  body: string;
  status: string;
  rule: string | null;
  why: string | null;
  examples: string[];
  history: string[];
};

export type Node = {
  path: string;
  title: string;
  summary: string;
  ruleIds: string[];
};

export type Taxonomy = { nodes: Map<string, Node>; rules: Map<string, Rule> };

export const RULES_DIR = "rules/";
export const isRulesPath = (path: string) => path.startsWith(RULES_DIR);
export const isNodeFile = (path: string) => /^rules\/(?:[^/]+\/)*index\.md$/.test(path);
export const nodePathOf = (file: string) => file.replace(/^rules\/?/, "").replace(/\/?index\.md$/, "");
export const nodeFileOf = (path: string) => (path ? `rules/${path}/index.md` : "rules/index.md");

const RULE_HEADING = /^## (\S+): (.+)$/gm;
export const RULE_ID = /^[A-Z][A-Z0-9]*-\d{3}$/;

export const field = (body: string, name: string) =>
  body.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, "m"))?.[1].trim() ?? null;

// Bullet lines following `**Name:**`, up to the next `**Field:**`.
export const listField = (body: string, name: string) => {
  const start = body.search(new RegExp(`^\\*\\*${name}:\\*\\*`, "m"));
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of body.slice(start).split("\n").slice(1)) {
    if (/^\*\*[^*]+:\*\*/.test(line)) break;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) items.push(item[1]);
  }
  return items;
};

export type NodeFile = { title: string | null; summary: string; rules: { id: string; title: string; body: string }[] };

export const parseNodeFile = (text: string): NodeFile => {
  const firstRule = text.search(/^## /m);
  const top = firstRule === -1 ? text : text.slice(0, firstRule);
  const headings = [...text.matchAll(RULE_HEADING)];
  return {
    title: top.match(/^# (.+)$/m)?.[1].trim() ?? null,
    summary: top.replace(/^# .+$/m, "").trim(),
    rules: headings.map((match, i) => ({
      id: match[1],
      title: match[2].trim(),
      body: text.slice(match.index, headings[i + 1]?.index ?? text.length).trim(),
    })),
  };
};

export const taxonomy = (files: Files): Taxonomy => {
  const nodes = new Map<string, Node>();
  const rules = new Map<string, Rule>();
  for (const file of Object.keys(files).filter(isNodeFile).sort()) {
    const path = nodePathOf(file);
    const parsed = parseNodeFile(files[file]);
    nodes.set(path, {
      path,
      title: parsed.title ?? (path.split("/").pop() || "Root"),
      summary: parsed.summary,
      ruleIds: parsed.rules.map((r) => r.id),
    });
    for (const r of parsed.rules) {
      rules.set(r.id, {
        id: r.id,
        title: r.title,
        node: path,
        body: r.body,
        status: field(r.body, "Status") ?? "active",
        rule: field(r.body, "Rule"),
        why: field(r.body, "Why"),
        examples: listField(r.body, "Examples"),
        history: listField(r.body, "History"),
      });
    }
  }
  return { nodes, rules };
};

// Nested tree for the map.
export type TreeNode = Node & { rules: Rule[]; children: TreeNode[] };
export const nestedTree = (files: Files): TreeNode => {
  const { nodes, rules } = taxonomy(files);
  if (!nodes.has("")) nodes.set("", { path: "", title: "Rules", summary: "", ruleIds: [] });
  const build = (path: string): TreeNode => {
    const node = nodes.get(path)!;
    const children = [...nodes.keys()]
      .filter((p) => p !== path && p.startsWith(path ? `${path}/` : "") && !p.slice(path ? path.length + 1 : 0).includes("/"))
      .sort()
      .map(build);
    return { ...node, rules: node.ruleIds.map((id) => rules.get(id)!).filter(Boolean), children };
  };
  return build("");
};

// Rule bodies minus History, so a move (which only adds a History line) reads as a move.
export const withoutHistory = (body: string) => body.replace(/\*\*History:\*\*[\s\S]*$/, "").trim();

export type NodeChange = { kind: "new" | "changed" | "removed"; path: string; title: string; summary: string; before: { title: string; summary: string } | null };
export type RuleChange = Rule & { kind: "new" | "changed" | "moved" | "retired" | "removed"; before: string | null; fromNode: string | null };

export const diffTaxonomy = (baseFiles: Files, headFiles: Files) => {
  const before = taxonomy(baseFiles);
  const after = taxonomy(headFiles);

  const nodeChanges: NodeChange[] = [];
  for (const [path, node] of after.nodes) {
    const old = before.nodes.get(path);
    if (!old) nodeChanges.push({ kind: "new", path, title: node.title, summary: node.summary, before: null });
    else if (old.title !== node.title || old.summary !== node.summary)
      nodeChanges.push({ kind: "changed", path, title: node.title, summary: node.summary, before: { title: old.title, summary: old.summary } });
  }
  for (const [path, old] of before.nodes) {
    if (!after.nodes.has(path)) nodeChanges.push({ kind: "removed", path, title: old.title, summary: old.summary, before: { title: old.title, summary: old.summary } });
  }

  const ruleChanges: RuleChange[] = [];
  for (const [id, rule] of after.rules) {
    const old = before.rules.get(id);
    if (!old) {
      ruleChanges.push({ ...rule, kind: "new", before: null, fromNode: null });
      continue;
    }
    if (old.body === rule.body && old.node === rule.node) continue;
    const moved = old.node !== rule.node;
    const retired = old.status !== "retired" && rule.status === "retired";
    const edited = withoutHistory(old.body) !== withoutHistory(rule.body);
    const kind = retired ? "retired" : moved && !edited ? "moved" : "changed";
    ruleChanges.push({ ...rule, kind, before: old.body, fromNode: moved ? old.node : null });
  }
  for (const [id, old] of before.rules) {
    if (!after.rules.has(id)) ruleChanges.push({ ...old, kind: "removed", body: "", before: old.body, fromNode: null });
  }
  return { nodeChanges, ruleChanges, before, after };
};

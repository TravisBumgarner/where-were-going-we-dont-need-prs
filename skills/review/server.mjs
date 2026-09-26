#!/usr/bin/env node
// Serves a PR-like page for reviewing the rules taxonomy changes on the current branch.
// Usage: node server.mjs [--base main] [--port 0] [--open]
// When the reviewer submits, decisions are written to .review/<branch>.json and the server exits.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const baseBranch = flag("base", "main");
const port = Number(flag("port", "0"));
const shouldOpen = args.includes("--open");
const here = dirname(fileURLToPath(import.meta.url));

const git = (...gitArgs) => execFileSync("git", gitArgs, { encoding: "utf8" }).trim();

const root = git("rev-parse", "--show-toplevel");
process.chdir(root);
const branch = git("branch", "--show-current");
if (!branch || branch === baseBranch) {
  console.error(`Refusing to review: on '${branch || "detached HEAD"}'. Switch to a work branch.`);
  process.exit(1);
}
const head = git("rev-parse", "HEAD");
const base = git("merge-base", baseBranch, "HEAD");

// ---------- Parse the taxonomy at a commit ----------

const isNodeFile = (path) => /^rules\/(?:[^/]+\/)*index\.md$/.test(path);
const nodePathOf = (file) => file.replace(/^rules\/?/, "").replace(/\/?index\.md$/, "");
const field = (body, name) => body.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, "m"))?.[1].trim();

const taxonomyAt = (ref) => {
  const nodes = new Map();
  const rules = new Map();
  const files = git("ls-tree", "-r", "--name-only", ref, "--", "rules/").split("\n").filter(isNodeFile);
  for (const file of files) {
    const text = git("show", `${ref}:${file}`);
    const path = nodePathOf(file);
    const firstRule = text.search(/^## /m);
    const top = firstRule === -1 ? text : text.slice(0, firstRule);
    const title = top.match(/^# (.+)$/m)?.[1].trim() ?? (path.split("/").pop() || "Root");
    const summary = top.replace(/^# .+$/m, "").trim();
    const headings = [...text.matchAll(/^## (\S+): (.+)$/gm)];
    const ids = [];
    headings.forEach((match, i) => {
      const body = text.slice(match.index, headings[i + 1]?.index ?? text.length).trim();
      rules.set(match[1], { id: match[1], title: match[2].trim(), node: path, body, status: field(body, "Status") });
      ids.push(match[1]);
    });
    nodes.set(path, { path, title, summary, ruleIds: ids });
  }
  return { nodes, rules };
};

// Rule bodies minus History, so a pure move (which only adds a History line) reads as a move.
const withoutHistory = (body) => body.replace(/\*\*History:\*\*[\s\S]*$/, "").trim();

const buildReview = () => {
  const before = taxonomyAt(base);
  const after = taxonomyAt(head);

  const nodeChanges = [];
  for (const [path, node] of after.nodes) {
    const old = before.nodes.get(path);
    if (!old) nodeChanges.push({ kind: "new", ...node, before: null });
    else if (old.title !== node.title || old.summary !== node.summary) nodeChanges.push({ kind: "changed", ...node, before: { title: old.title, summary: old.summary } });
  }
  for (const [path, old] of before.nodes) {
    if (!after.nodes.has(path)) nodeChanges.push({ kind: "removed", ...old, before: { title: old.title, summary: old.summary } });
  }

  const ruleChanges = [];
  for (const [id, rule] of after.rules) {
    const old = before.rules.get(id);
    if (!old) {
      ruleChanges.push({ kind: "new", ...rule, before: null, fromNode: null });
      continue;
    }
    if (old.body === rule.body && old.node === rule.node) continue;
    const moved = old.node !== rule.node;
    const retired = old.status !== "retired" && rule.status === "retired";
    const edited = withoutHistory(old.body) !== withoutHistory(rule.body);
    const kind = retired ? "retired" : moved && !edited ? "moved" : "changed";
    ruleChanges.push({ kind, ...rule, before: old.body, fromNode: moved ? old.node : null });
  }
  for (const [id, old] of before.rules) {
    if (!after.rules.has(id)) ruleChanges.push({ kind: "removed", ...old, body: null, before: old.body, fromNode: null });
  }

  // Full head tree (plus removed nodes), for the sidebar outline and "Move to" options.
  const tree = [...after.nodes.values()].map(({ path, title, summary, ruleIds }) => ({ path, title, summary, ruleIds }));
  for (const change of nodeChanges.filter((c) => c.kind === "removed")) {
    tree.push({ path: change.path, title: change.title, summary: change.summary, ruleIds: [], removed: true });
  }
  tree.sort((a, b) => a.path.localeCompare(b.path));

  // Unchanged rules per node, shown as collapsible context around the changes.
  const changedIds = new Set(ruleChanges.map((r) => r.id));
  const context = {};
  for (const rule of after.rules.values()) {
    if (changedIds.has(rule.id)) continue;
    (context[rule.node] ??= []).push({ id: rule.id, title: rule.title, body: rule.body, status: rule.status });
  }

  const log = git("log", "--format=%h%x09%s", `${base}..${head}`);
  const commits = log ? log.split("\n").map((line) => {
    const [hash, subject] = line.split("\t");
    return { hash, subject };
  }) : [];
  const codeFiles = git("diff", "--name-only", base, head).split("\n").filter((p) => p && !p.startsWith("rules/"));
  const uncommitted = git("status", "--porcelain", "--", "rules/");

  return { branch, baseBranch, base, head, commits, codeFiles, uncommittedRules: Boolean(uncommitted), tree, nodeChanges, ruleChanges, context };
};

const review = buildReview();
const page = readFileSync(join(here, "review.html"), "utf8");

// The zoomable map of the branch's rules, built on demand by the map skill.
const mapHtml = () => {
  const out = join(tmpdir(), `tb-review-map-${process.pid}.html`);
  execFileSync("node", [join(here, "..", "map", "build.mjs"), "--rules", join(root, "rules"), "--out", out, "--no-open"]);
  return readFileSync(out, "utf8");
};

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
  } else if (req.method === "GET" && req.url === "/map") {
    try {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(mapHtml());
    } catch (err) {
      res.writeHead(500).end(`Couldn't build the map: ${err.message}`);
    }
  } else if (req.method === "GET" && req.url === "/api/review") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(review));
  } else if (req.method === "POST" && req.url === "/api/decisions") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const submitted = JSON.parse(raw);
      const outPath = join(".review", `${branch.replaceAll("/", "__")}.json`);
      mkdirSync(".review", { recursive: true });
      writeFileSync(outPath, `${JSON.stringify({ branch, base, head, reviewedAt: new Date().toISOString(), ...submitted }, null, 2)}\n`);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      console.log(`DECISIONS_WRITTEN ${join(root, outPath)}`);
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
  } else {
    res.writeHead(404).end();
  }
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`REVIEW_URL ${url}`);
  console.log(`${review.ruleChanges.length} rule change(s), ${review.nodeChanges.length} node change(s) on ${branch} vs ${baseBranch}`);
  if (shouldOpen) execFileSync("open", [url]);
});
